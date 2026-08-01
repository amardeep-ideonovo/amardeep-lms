import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuditService } from './audit.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
function make(create: (a: any) => Promise<unknown>): AuditService {
  return new AuditService({ auditLog: { create } } as any);
}

test('write() persists the entry with normalized fields', async () => {
  let arg: any = null;
  const svc = make(async (a) => {
    arg = a;
    return {};
  });
  await svc.write({
    actorAdminId: 'a1',
    action: 'member.password_reset',
    targetType: 'user',
    targetId: 'u1',
    ip: '1.2.3.4',
  });
  assert.equal(arg.data.action, 'member.password_reset');
  assert.equal(arg.data.actorAdminId, 'a1');
  assert.equal(arg.data.targetType, 'user');
  assert.equal(arg.data.targetId, 'u1');
  assert.equal(arg.data.ip, '1.2.3.4');
  assert.deepEqual(arg.data.metadata, {});
});

test('write() defaults missing fields to null / {}', async () => {
  let arg: any = null;
  const svc = make(async (a) => {
    arg = a;
    return {};
  });
  await svc.write({ action: 'member.level_grant', metadata: { levelId: 'L1' } });
  assert.equal(arg.data.actorAdminId, null);
  assert.equal(arg.data.targetId, null);
  assert.deepEqual(arg.data.metadata, { levelId: 'L1' });
});

test('write() swallows errors so it never blocks the underlying mutation', async () => {
  const svc = make(async () => {
    throw new Error('db down');
  });
  await svc.write({ action: 'x' }); // must resolve, not throw
  assert.ok(true);
});
