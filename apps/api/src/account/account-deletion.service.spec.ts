import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { AccountDeletionService } from './account-deletion.service';

// Adversarial coverage for the member-deletion purge. Each test pins one of the
// invariants the three-agent audit flagged as a way this feature could silently
// go wrong: cancel-before-delete ordering, abort-on-cancel-failure (never
// orphan a live subscription), tombstone-not-delete for email suppression,
// queued-mail cancellation, mirror anonymization, notification redaction, and
// post-commit file cleanup.

 

type Harness = {
  svc: any;
  calls: string[]; // ordered log of the load-bearing operations
  txOps: Record<string, any[]>; // captured args per tx model.method
  billingCancel: { count: number; throw: boolean };
  unlinked: string[][];
  deletedAvatarKeys: string[];
  notifications: any[];
};

function makeHarness(opts: {
  user?: any;
  contacts?: any[];
  certFileKeys?: string[];
  adminNotes?: any[];
  cancelThrows?: boolean;
  defaultAudienceId?: string | null;
  userDeleteThrows?: any;
}): Harness {
  const user =
    opts.user ??
    ({
      id: 'u1',
      email: 'member@example.com',
      passwordHash: bcrypt.hashSync('correct-horse', 10),
      avatarUrl: 'https://api.example.com/media/avatar-u1-123.png',
      stripeCustomerId: 'cus_1',
    } as any);

  const calls: string[] = [];
  const txOps: Record<string, any[]> = {};
  const record = (k: string, arg: any) => {
    (txOps[k] ??= []).push(arg);
  };

  const tx: any = {
    contact: {
      findMany: async () => opts.contacts ?? [],
      update: async (a: any) => {
        record('contact.update', a);
        calls.push('contact.update');
        return {};
      },
      create: async (a: any) => {
        record('contact.create', a);
        calls.push('contact.create');
        return { id: 'tombstone1' };
      },
      delete: async (a: any) => {
        record('contact.delete', a);
        calls.push('contact.delete'); // MUST never happen
        return {};
      },
    },
    audience: {
      findFirst: async () =>
        opts.defaultAudienceId === null
          ? null
          : { id: opts.defaultAudienceId ?? 'aud-default' },
    },
    consentEvent: {
      create: async (a: any) => {
        record('consentEvent.create', a);
        return {};
      },
    },
    scheduledEmail: {
      updateMany: async (a: any) => {
        record('scheduledEmail.updateMany', a);
        calls.push('scheduledEmail.updateMany');
        return { count: 0 };
      },
    },
    adminNotification: {
      findMany: async () => opts.adminNotes ?? [],
      update: async (a: any) => {
        record('adminNotification.update', a);
        return {};
      },
    },
    subscriptionMirror: {
      updateMany: async (a: any) => {
        record('subscriptionMirror.updateMany', a);
        calls.push('subscriptionMirror.updateMany');
        return { count: 0 };
      },
    },
    user: {
      delete: async (a: any) => {
        record('user.delete', a);
        calls.push('user.delete');
        if (opts.userDeleteThrows) throw opts.userDeleteThrows;
        return {};
      },
    },
  };

  const prisma: any = {
    user: { findUnique: async () => user },
    certificate: {
      findMany: async () =>
        (opts.certFileKeys ?? []).map((k) => ({ fileKey: k })),
    },
    $transaction: async (cb: any) => cb(tx),
  };

  const billingCancel = { count: 0, throw: !!opts.cancelThrows };
  const billing: any = {
    cancelAllSubscriptionsForDeletion: async () => {
      billingCancel.count++;
      calls.push('billing.cancel');
      if (billingCancel.throw) throw new Error('provider down');
      return { canceledSubIds: [] };
    },
    getMySubscriptionDetails: async () => [],
  };

  const unlinked: string[][] = [];
  const certificates: any = {
    unlinkCertificateFiles: async (keys: string[]) => {
      unlinked.push(keys);
      calls.push('unlinkCertificateFiles');
    },
    mine: async () => [],
  };

  const notifications: any[] = [];
  const notificationsSvc: any = {
    record: async (n: any) => {
      notifications.push(n);
    },
  };

  const deletedAvatarKeys: string[] = [];
  const storage: any = {
    delete: async (key: string) => {
      deletedAvatarKeys.push(key);
    },
  };

  const svc = new AccountDeletionService(
    prisma,
    billing,
    certificates,
    notificationsSvc,
    storage,
  );

  return {
    svc,
    calls,
    txOps,
    billingCancel,
    unlinked,
    deletedAvatarKeys,
    notifications,
  };
}

test('cancels subscriptions BEFORE deleting the user', async () => {
  const h = makeHarness({});
  await h.svc.deleteMember('u1', {
    password: 'correct-horse',
    actor: { kind: 'self' },
  });
  const cancelIdx = h.calls.indexOf('billing.cancel');
  const deleteIdx = h.calls.indexOf('user.delete');
  assert.ok(cancelIdx >= 0, 'must cancel subscriptions');
  assert.ok(deleteIdx >= 0, 'must delete the user');
  assert.ok(cancelIdx < deleteIdx, 'cancel must run before the user delete');
});

test('a subscription-cancel failure ABORTS the deletion (user is never deleted)', async () => {
  const h = makeHarness({ cancelThrows: true });
  await assert.rejects(
    () =>
      h.svc.deleteMember('u1', {
        password: 'correct-horse',
        actor: { kind: 'self' },
      }),
    /could not automatically cancel/i,
  );
  assert.equal(h.billingCancel.count, 1);
  assert.ok(
    !h.calls.includes('user.delete'),
    'user must NOT be deleted when a subscription cancel fails',
  );
});

test('wrong password rejects before any cancellation or deletion', async () => {
  const h = makeHarness({});
  await assert.rejects(
    () =>
      h.svc.deleteMember('u1', {
        password: 'wrong',
        actor: { kind: 'self' },
      }),
    /password is incorrect/i,
  );
  assert.equal(h.billingCancel.count, 0, 'must not touch billing');
  assert.ok(!h.calls.includes('user.delete'));
});

test('admin path skips the password check and still purges', async () => {
  const h = makeHarness({});
  await h.svc.deleteMember('u1', { actor: { kind: 'admin', adminId: 'a1' } });
  assert.ok(h.calls.includes('user.delete'));
  assert.equal(h.notifications[0]?.type, 'MEMBER_DELETED');
  assert.match(h.notifications[0]?.body ?? '', /by an admin/i);
});

test('contacts are TOMBSTONED (unsubscribed), never deleted', async () => {
  const h = makeHarness({
    contacts: [{ id: 'c1' }, { id: 'c2' }],
  });
  await h.svc.deleteMember('u1', {
    password: 'correct-horse',
    actor: { kind: 'self' },
  });
  assert.ok(!h.calls.includes('contact.delete'), 'contact must never be deleted');
  const updates = h.txOps['contact.update'] ?? [];
  assert.equal(updates.length, 2);
  for (const u of updates) {
    assert.equal(u.data.status, 'UNSUBSCRIBED');
    assert.equal(u.data.userId, null);
  }
  assert.equal((h.txOps['consentEvent.create'] ?? []).length, 2);
});

test('pending queued mail to the address is canceled', async () => {
  const h = makeHarness({});
  await h.svc.deleteMember('u1', {
    password: 'correct-horse',
    actor: { kind: 'self' },
  });
  const [call] = h.txOps['scheduledEmail.updateMany'] ?? [];
  assert.ok(call, 'must cancel scheduled email');
  assert.equal(call.where.to, 'member@example.com');
  assert.equal(call.where.status, 'PENDING');
  assert.equal(call.data.status, 'CANCELED');
});

test('subscription mirrors are anonymized (userId nulled)', async () => {
  const h = makeHarness({});
  await h.svc.deleteMember('u1', {
    password: 'correct-horse',
    actor: { kind: 'self' },
  });
  const [call] = h.txOps['subscriptionMirror.updateMany'] ?? [];
  assert.ok(call);
  assert.deepEqual(call.where, { userId: 'u1' });
  assert.equal(call.data.userId, null);
});

test('member email is redacted from admin-notification bodies', async () => {
  const h = makeHarness({
    adminNotes: [
      { id: 'n1', body: 'Payment failed for member@example.com on Pro' },
    ],
  });
  await h.svc.deleteMember('u1', {
    password: 'correct-horse',
    actor: { kind: 'self' },
  });
  const [upd] = h.txOps['adminNotification.update'] ?? [];
  assert.ok(upd);
  assert.equal(upd.data.userId, null);
  assert.ok(!upd.data.body.includes('member@example.com'));
  assert.match(upd.data.body, /\[deleted member\]/);
});

test('certificate PDFs and avatar are unlinked AFTER the delete commits', async () => {
  const h = makeHarness({ certFileKeys: ['CERT-1.pdf', 'CERT-2.pdf'] });
  await h.svc.deleteMember('u1', {
    password: 'correct-horse',
    actor: { kind: 'self' },
  });
  // file cleanup runs after the user delete
  const delIdx = h.calls.indexOf('user.delete');
  const unlinkIdx = h.calls.indexOf('unlinkCertificateFiles');
  assert.ok(unlinkIdx > delIdx, 'files unlink after the DB commit');
  assert.deepEqual(h.unlinked[0], ['CERT-1.pdf', 'CERT-2.pdf']);
  assert.deepEqual(h.deletedAvatarKeys, ['avatar-u1-123.png']);
});

test('an opted-out member with no Contact gets a suppression tombstone (stays un-mailable)', async () => {
  const h = makeHarness({
    user: {
      id: 'u1',
      email: 'gone@example.com',
      passwordHash: bcrypt.hashSync('correct-horse', 10),
      avatarUrl: null,
      stripeCustomerId: null,
      emailOptOut: true, // unsubscribed, but never landed in an audience
    } as any,
    contacts: [], // no existing Contact carries the suppression
  });
  await h.svc.deleteMember('u1', {
    password: 'correct-horse',
    actor: { kind: 'self' },
  });
  const [create] = h.txOps['contact.create'] ?? [];
  assert.ok(create, 'must materialize a suppressed tombstone contact');
  assert.equal(create.data.status, 'UNSUBSCRIBED');
  assert.equal(create.data.email, 'gone@example.com');
  assert.equal(create.data.audienceId, 'aud-default');
});

test('opted-out member with NO default audience does not crash (skips tombstone)', async () => {
  const h = makeHarness({
    user: {
      id: 'u1',
      email: 'gone@example.com',
      passwordHash: bcrypt.hashSync('correct-horse', 10),
      avatarUrl: null,
      stripeCustomerId: null,
      emailOptOut: true,
    } as any,
    contacts: [],
    defaultAudienceId: null,
  });
  await h.svc.deleteMember('u1', {
    password: 'correct-horse',
    actor: { kind: 'self' },
  });
  assert.ok(!h.calls.includes('contact.create'));
  assert.ok(h.calls.includes('user.delete'), 'deletion still completes');
});

test('a member who never opted out is NOT newly suppressed', async () => {
  const h = makeHarness({ contacts: [] }); // default user has emailOptOut undefined
  await h.svc.deleteMember('u1', {
    password: 'correct-horse',
    actor: { kind: 'self' },
  });
  assert.ok(!h.calls.includes('contact.create'), 'no tombstone for a non-opted-out member');
});

test('concurrent double-delete (P2025) resolves idempotently, not a 500', async () => {
  const h = makeHarness({
    userDeleteThrows: new Prisma.PrismaClientKnownRequestError('Record not found', {
      code: 'P2025',
      clientVersion: 'test',
    }),
  });
  const res = await h.svc.deleteMember('u1', {
    password: 'correct-horse',
    actor: { kind: 'self' },
  });
  assert.deepEqual(res, { ok: true });
  // the concurrent loser skips post-commit cleanup (the winner did it)
  assert.ok(!h.calls.includes('unlinkCertificateFiles'));
});

test('summary reports true stakes and omits nothing it has', async () => {
  const h = makeHarness({});
  h.svc['billing'].getMySubscriptionDetails = async () => [
    { stripeSubId: 'sub_1', levelName: 'Pro', amount: 2900 } as any,
  ];
  h.svc['certificates'].mine = async () => [{ id: 'cert1' } as any];
  const prisma = h.svc['prisma'];
  prisma.userCourse = {
    findMany: async () => [
      {
        courseId: 'co1',
        amount: 4900,
        currency: 'usd',
        grantedAt: new Date('2026-01-01'),
        course: { title: 'Advanced Linework' },
      },
    ],
  };
  prisma.userLevel = {
    findMany: async () => [{ levelId: 'l1', level: { name: 'Lifetime Club' } }],
  };
  prisma.lessonProgress = { count: async () => 38 };

  const s = await h.svc.summaryFor('u1');
  assert.equal(s.email, 'member@example.com');
  assert.equal(s.subscriptions.length, 1);
  assert.equal(s.certificates.length, 1);
  assert.equal(s.lifetimeCourses[0].title, 'Advanced Linework');
  assert.equal(s.lifetimeLevels[0].levelName, 'Lifetime Club');
  assert.equal(s.completedLessons, 38);
  assert.equal(s.hasPaymentHistory, true);
});
