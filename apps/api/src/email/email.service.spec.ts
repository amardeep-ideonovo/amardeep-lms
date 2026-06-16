import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Logger } from '@nestjs/common';
import { EmailService } from './email.service';

// Unit tests for EmailService's two hard contracts:
//  - sendTemplate()/send() NEVER throw into the triggering business flow, and
//  - the dedupeKey audit row is never regressed once it reached SENT.
// Collaborators (Prisma, the renderer, the sender) are plain mocks so we can
// drive the exact failure branches (missing signing secret, deleted template,
// a prior SENT row) without a DB or a real transport.

// Keep test output clean — EmailService logs warn/error on every degraded path.
before(() => Logger.overrideLogger(false));

// ---------------------------------------------------------------------------
// Mock builders
// ---------------------------------------------------------------------------

type Row = Record<string, unknown> & { status?: string };

// A Prisma stand-in that records every call and lets each method's behavior be
// overridden per test. Anything not overridden defaults to "nothing found".
function makePrisma(overrides: Record<string, (args?: any) => any> = {}) {
  const calls: Record<string, any[]> = {};
  const fn = (name: string, fallback: (args?: any) => any) => {
    calls[name] = [];
    return (args?: any) => {
      calls[name].push(args);
      return Promise.resolve(
        (overrides[name] ?? fallback)(args),
      );
    };
  };
  const prisma = {
    emailLog: {
      findUnique: fn('emailLog.findUnique', () => null),
      upsert: fn('emailLog.upsert', (a: any) => ({ id: 'upserted', ...a.create, ...a.update })),
      create: fn('emailLog.create', (a: any) => ({ id: 'created', ...a.data })),
      update: fn('emailLog.update', (a: any) => ({ id: a.where.id, ...a.data })),
    },
    contact: { findFirst: fn('contact.findFirst', () => null) },
    user: { findFirst: fn('user.findFirst', () => null) },
  };
  return { prisma, calls };
}

function makeTemplates(rendered: (vars: any) => any) {
  const seen: { vars?: any } = {};
  return {
    seen,
    service: {
      renderByKey: (_key: string, vars: any) => {
        seen.vars = vars;
        return Promise.resolve(rendered(vars));
      },
      renderById: (_id: string, vars: any) => {
        seen.vars = vars;
        return Promise.resolve(rendered(vars));
      },
    },
  };
}

function makeSender(over: Partial<{ configured: boolean; send: (a: any) => any }> = {}) {
  const seen: { send?: any } = {};
  return {
    seen,
    sender: {
      isConfigured: () => Promise.resolve(over.configured ?? true),
      send: (a: any) => {
        seen.send = a;
        return Promise.resolve((over.send ?? (() => ({ providerId: 'prov-1' })))(a));
      },
    },
  };
}

// Run `fn` with ENV_NAME/JWT_SECRET/SETTINGS_ENC_KEY set to exact values (an
// `undefined` entry means "unset"), restoring the prior environment after.
async function withEnv(
  env: Partial<Record<'ENV_NAME' | 'JWT_SECRET' | 'SETTINGS_ENC_KEY', string | undefined>>,
  fn: () => Promise<void>,
) {
  const keys = ['ENV_NAME', 'JWT_SECRET', 'SETTINGS_ENC_KEY'] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) {
    if (k in env) {
      if (env[k] === undefined) delete process.env[k];
      else process.env[k] = env[k];
    }
  }
  try {
    await fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k] as string;
    }
  }
}

// ---------------------------------------------------------------------------
// Gap 1 — sendTemplate() must not let a missing-signing-secret throw escape.
// ---------------------------------------------------------------------------

test('sendTemplate: missing signing secret in production degrades to no unsubscribe link instead of throwing', async () => {
  // Production + no JWT_SECRET/SETTINGS_ENC_KEY => makeUnsubscribeToken fails closed.
  await withEnv(
    { ENV_NAME: 'production', JWT_SECRET: undefined, SETTINGS_ENC_KEY: undefined },
    async () => {
      const { prisma } = makePrisma();
      const { service: templates, seen: tplSeen } = makeTemplates(() => ({
        subject: 'Hi',
        html: '<p>hi</p>',
        text: 'hi',
      }));
      const { sender, seen: senderSeen } = makeSender();
      const svc = new EmailService(prisma as any, sender as any, templates as any);

      // Must resolve (not reject) even though token signing throws.
      const log = await svc.sendTemplate({
        to: 'User@Example.com',
        templateKey: 'welcome',
        vars: { name: 'Pat' },
      });

      assert.equal(log.status, 'SENT');
      // Degraded gracefully: the render saw no unsubscribeUrl...
      assert.equal('unsubscribeUrl' in (tplSeen.vars ?? {}), false);
      // ...and no List-Unsubscribe header was put on the wire.
      assert.equal(senderSeen.send?.listUnsubscribe, undefined);
    },
  );
});

test('sendTemplate: with a signing secret, the unsubscribe link is rendered and sent', async () => {
  // Control for the gap-1 test: the link IS produced when a secret exists.
  await withEnv({ ENV_NAME: 'production', JWT_SECRET: 'top-secret', SETTINGS_ENC_KEY: undefined }, async () => {
    const { prisma } = makePrisma();
    const { service: templates, seen: tplSeen } = makeTemplates(() => ({
      subject: 'Hi',
      html: '<p>hi</p>',
      text: 'hi',
    }));
    const { sender, seen: senderSeen } = makeSender();
    const svc = new EmailService(prisma as any, sender as any, templates as any);

    const log = await svc.sendTemplate({ to: 'a@b.com', templateKey: 'welcome', vars: {} });

    assert.equal(log.status, 'SENT');
    assert.match(String((tplSeen.vars ?? {}).unsubscribeUrl), /\/unsubscribe\?token=/);
    assert.match(String(senderSeen.send?.listUnsubscribe), /\/unsubscribe\?token=/);
  });
});

// ---------------------------------------------------------------------------
// Gap 2 — a render failure must never clobber an already-SENT audit row.
// ---------------------------------------------------------------------------

test('sendTemplate: render failure does NOT overwrite a prior SENT row for the same dedupeKey', async () => {
  await withEnv({ ENV_NAME: 'development' }, async () => {
    const priorSent: Row = {
      id: 'log-sent',
      status: 'SENT',
      dedupeKey: 'welcome:42',
      providerId: 'prov-orig',
    };
    const { prisma, calls } = makePrisma({
      'emailLog.findUnique': () => priorSent, // the dedupeKey already delivered
    });
    // Template was deleted after the original delivery => render throws.
    const { service: templates } = makeTemplates(() => {
      throw new Error('template not found');
    });
    const { sender } = makeSender();
    const svc = new EmailService(prisma as any, sender as any, templates as any);

    const log = await svc.sendTemplate({
      to: 'a@b.com',
      templateKey: 'welcome',
      vars: {},
      dedupeKey: 'welcome:42',
    });

    // The SENT audit row is returned untouched...
    assert.equal(log.status, 'SENT');
    assert.equal(log.id, 'log-sent');
    assert.equal(log.providerId, 'prov-orig');
    // ...and nothing was written: no upsert/create flipped it to FAILED.
    assert.equal(calls['emailLog.upsert'].length, 0);
    assert.equal(calls['emailLog.create'].length, 0);
  });
});

test('sendTemplate: render failure with no prior SENT row still records a FAILED audit row (guard is SENT-only)', async () => {
  await withEnv({ ENV_NAME: 'development' }, async () => {
    const { prisma, calls } = makePrisma({
      'emailLog.findUnique': () => null, // nothing delivered yet
    });
    const { service: templates } = makeTemplates(() => {
      throw new Error('template not found');
    });
    const { sender } = makeSender();
    const svc = new EmailService(prisma as any, sender as any, templates as any);

    const log = await svc.sendTemplate({
      to: 'a@b.com',
      templateKey: 'welcome',
      vars: {},
      dedupeKey: 'welcome:99',
    });

    assert.equal(log.status, 'FAILED');
    // The failure WAS persisted (the guard only protects prior-SENT rows).
    assert.equal(calls['emailLog.upsert'].length, 1);
    assert.equal(calls['emailLog.upsert'][0].create.status, 'FAILED');
  });
});

// ---------------------------------------------------------------------------
// Standing guarantees these fixes must not regress.
// ---------------------------------------------------------------------------

test('send: a prior SENT row for the dedupeKey short-circuits — no re-send (idempotency)', async () => {
  await withEnv({ ENV_NAME: 'development' }, async () => {
    const priorSent: Row = { id: 'log-sent', status: 'SENT', dedupeKey: 'k1' };
    const { prisma } = makePrisma({ 'emailLog.findUnique': () => priorSent });
    const { sender, seen: senderSeen } = makeSender();
    const svc = new EmailService(prisma as any, sender as any, {} as any);

    const log = await svc.send({
      to: 'a@b.com',
      subject: 's',
      html: '<p>',
      dedupeKey: 'k1',
    });

    assert.equal(log.id, 'log-sent');
    assert.equal(senderSeen.send, undefined); // sender never invoked
  });
});

test('send: never throws — a total DB failure degrades to an in-memory FAILED stub', async () => {
  await withEnv({ ENV_NAME: 'development' }, async () => {
    const blowUp = () => {
      throw new Error('db down');
    };
    const { prisma } = makePrisma({
      'emailLog.findUnique': blowUp,
      'emailLog.upsert': blowUp,
      'emailLog.create': blowUp,
      'emailLog.update': blowUp,
      'contact.findFirst': blowUp,
      'user.findFirst': blowUp,
    });
    const { sender } = makeSender();
    const svc = new EmailService(prisma as any, sender as any, {} as any);

    const log = await svc.send({
      to: 'a@b.com',
      subject: 's',
      html: '<p>',
      dedupeKey: 'k2',
    });

    assert.equal(log.status, 'FAILED');
    assert.equal(log.id, ''); // the failureStub shape
  });
});
