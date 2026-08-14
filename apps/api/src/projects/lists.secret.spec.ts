import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceUnavailableException } from '@nestjs/common';
import { ListsService } from './lists.service';
import { ENC_PREFIX, isSealed, sealSecretValue } from './secret-value.util';

// End-to-end behaviour of at-rest SECRET encryption through the service:
// sealed on the way in, never emitted on the way out, plaintext only via the
// audited reveal — and legacy (pre-encryption) rows keep working throughout.

const KEY = Buffer.alloc(32, 5).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 6).toString('base64');

function setKey(key: string | undefined): string | undefined {
  const prev = process.env.SETTINGS_ENC_KEY;
  if (key === undefined) delete process.env.SETTINGS_ENC_KEY;
  else process.env.SETTINGS_ENC_KEY = key;
  return prev;
}

function restoreKey(prev: string | undefined): void {
  if (prev === undefined) delete process.env.SETTINGS_ENC_KEY;
  else process.env.SETTINGS_ENC_KEY = prev;
}

function withKey<T>(key: string | undefined, fn: () => T): T {
  const prev = setKey(key);
  try {
    return fn();
  } finally {
    restoreKey(prev);
  }
}

// Async variant — the sync one would restore the key BEFORE an awaited body
// ever ran, so the code under test would see no key at all.
async function withKeyAsync<T>(
  key: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = setKey(key);
  try {
    return await fn();
  } finally {
    restoreKey(prev);
  }
}

 
function make(prisma: any, audit: any = { write: async () => {} }): ListsService {
  return new ListsService(prisma, {} as any, {} as any, {} as any, audit);
}

const SECRET_FIELD = { id: 'f_secret', type: 'SECRET', name: 'API Key', options: null };
const TEXT_FIELD = { id: 'f_text', type: 'TEXT', name: 'Note', options: null };

function itemRow(values: Record<string, unknown>) {
  return {
    id: 'i1',
    listId: 'L1',
    title: 't',
    status: 'TODO',
    assigneeAdminId: null,
    dueDate: null,
    position: 0,
    values,
    createdFromMessageId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    _count: { comments: 0 },
  };
}

test('a written SECRET is sealed before it reaches the database', async () => {
  await withKeyAsync(KEY, async () => {
    const svc = make({
      chatListField: { findMany: async () => [SECRET_FIELD] },
    });
    const out: any = await (svc as any).validateValues('L1', {
      f_secret: 'sk_live_abc',
    });
    assert.ok(isSealed(out.f_secret), 'value should carry the enc envelope');
    assert.ok(!String(out.f_secret).includes('sk_live_abc'));
  });
});

test('an empty SECRET clears the cell instead of storing ciphertext-of-empty', async () => {
  await withKeyAsync(KEY, async () => {
    const svc = make({ chatListField: { findMany: async () => [SECRET_FIELD] } });
    const out: any = await (svc as any).validateValues('L1', { f_secret: '' });
    // Sealing '' would produce a non-empty blob that reads back as "secret set".
    assert.equal(out.f_secret, null);
  });
});

test('an over-long SECRET is rejected', async () => {
  await withKeyAsync(KEY, async () => {
    const svc = make({ chatListField: { findMany: async () => [SECRET_FIELD] } });
    await assert.rejects(() =>
      (svc as any).validateValues('L1', { f_secret: 'a'.repeat(4097) }),
    );
  });
});

test('a non-SECRET value is stored untouched', async () => {
  await withKeyAsync(KEY, async () => {
    const svc = make({ chatListField: { findMany: async () => [TEXT_FIELD] } });
    const out: any = await (svc as any).validateValues('L1', { f_text: 'plain' });
    assert.equal(out.f_text, 'plain');
  });
});

test('serialization never emits a SECRET, sealed or legacy', () => {
  withKey(KEY, () => {
    const svc = make({});
    const sealed = sealSecretValue('sk_live_abc');
    for (const stored of [sealed, 'legacy-plaintext']) {
      const dto: any = (svc as any).toItemDTO(itemRow({ f_secret: stored }), [
        SECRET_FIELD,
      ]);
      assert.equal('f_secret' in dto.values, false);
      assert.deepEqual(dto.secretFieldIds, ['f_secret']);
      assert.ok(!JSON.stringify(dto).includes('sk_live_abc'));
      assert.ok(!JSON.stringify(dto).includes('legacy-plaintext'));
    }
  });
});

test('a sealed blob left under a retyped (SECRET -> TEXT) field is not surfaced', () => {
  withKey(KEY, () => {
    const svc = make({});
    // updateField does not rewrite stored values, so this really happens.
    const dto: any = (svc as any).toItemDTO(
      itemRow({ f_text: sealSecretValue('sk_live_abc') }),
      [TEXT_FIELD],
    );
    assert.equal('f_text' in dto.values, false);
    assert.ok(!JSON.stringify(dto).includes(ENC_PREFIX));
  });
});

function revealPrisma(stored: unknown) {
  return {
    chatListItem: {
      findUnique: async () => ({
        ...itemRow({ f_secret: stored }),
        list: { channelId: null, fields: [SECRET_FIELD] },
      }),
    },
  };
}

test('reveal decrypts a sealed secret and audits the access', async () => {
  const sealed = withKey(KEY, () => sealSecretValue('sk_live_abc'));
  await withKeyAsync(KEY, async () => {
    const audited: any[] = [];
    const svc = make(revealPrisma(sealed), {
      write: async (e: any) => audited.push(e),
    });
    const res = await svc.revealSecret('admin1', 'i1', 'f_secret', '1.2.3.4');
    assert.equal(res.value, 'sk_live_abc');
    assert.equal(audited.length, 1);
    assert.equal(audited[0].action, 'projects.secret.reveal');
  });
});

test('reveal returns a legacy plaintext secret unchanged', async () => {
  await withKeyAsync(KEY, async () => {
    const svc = make(revealPrisma('legacy-plaintext'));
    const res = await svc.revealSecret('admin1', 'i1', 'f_secret', null);
    assert.equal(res.value, 'legacy-plaintext');
  });
});

test('reveal of an unreadable secret fails loudly and still audits', async () => {
  const sealed = withKey(KEY, () => sealSecretValue('sk_live_abc'));
  await withKeyAsync(OTHER_KEY, async () => {
    const audited: any[] = [];
    const svc = make(revealPrisma(sealed), {
      write: async (e: any) => audited.push(e),
    });
    // Must NOT degrade to {value: null} — that reads as "no secret set" and
    // invites an overwrite that would destroy a recoverable credential.
    await assert.rejects(
      () => svc.revealSecret('admin1', 'i1', 'f_secret', null),
      ServiceUnavailableException,
    );
    assert.equal(audited.length, 1, 'a failed attempt is still an access attempt');
  });
});

test('reveal reports an unset secret as null', async () => {
  await withKeyAsync(KEY, async () => {
    const svc = make(revealPrisma(undefined));
    const res = await svc.revealSecret('admin1', 'i1', 'f_secret', null);
    assert.equal(res.value, null);
  });
});
