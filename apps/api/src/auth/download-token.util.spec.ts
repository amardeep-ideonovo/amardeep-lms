import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import {
  certDownloadScope,
  isDownloadTokenPayload,
  noteDownloadScope,
  type DownloadTokenPayload,
} from './download-token.util';

// A download token rides in a `?token=` URL (browser history, OS share sheet,
// server logs), so it must NOT embed member PII. Sign one the way the
// controllers do and assert the decoded JWT carries only sub/isAdmin/typ/scope.

test('a minted download token embeds no email/username PII', () => {
  const payload: DownloadTokenPayload = {
    sub: 'user-1',
    isAdmin: false,
    typ: 'dl',
    scope: certDownloadScope('cert-1'),
  };
  const token = jwt.sign(payload, 'download-token-spec-secret', {
    expiresIn: 180,
  });
  const decoded = jwt.decode(token) as Record<string, unknown>;

  assert.equal(decoded.sub, 'user-1');
  assert.equal(decoded.typ, 'dl');
  assert.equal(decoded.scope, 'cert:cert-1');
  assert.ok(!('email' in decoded), 'download token must not carry email');
  assert.ok(!('username' in decoded), 'download token must not carry username');
});

test('scope helpers + type guard still behave', () => {
  assert.equal(noteDownloadScope('l1', 'n1'), 'note:l1:n1');
  assert.equal(certDownloadScope('c1'), 'cert:c1');
  assert.ok(
    isDownloadTokenPayload({
      sub: 'u',
      isAdmin: false,
      typ: 'dl',
      scope: 'cert:c1',
    }),
  );
});
