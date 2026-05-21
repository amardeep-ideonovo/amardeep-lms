import { Injectable } from '@nestjs/common';
import { createSign } from 'crypto';

// Issues short-lived signed playback tokens for Mux video. Tokens are JWTs
// (RS256) signed with a Mux signing key, scoped to a playbackId.
@Injectable()
export class MuxService {
  private base64url(input: Buffer | string): string {
    return Buffer.from(input)
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  }

  /**
   * Build a signed Mux playback JWT for the given asset/playback id.
   * Returns undefined if signing is not configured.
   */
  signPlaybackToken(playbackId: string, ttlSeconds = 3600): string | undefined {
    const keyId = process.env.MUX_SIGNING_KEY_ID;
    const privateKeyB64 = process.env.MUX_SIGNING_KEY_PRIVATE;
    if (!keyId || !privateKeyB64) {
      // Not configured (e.g. local dev) — caller decides whether to omit.
      return undefined;
    }

    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT', kid: keyId };
    const payload = {
      sub: playbackId,
      aud: 'v', // "v" = video playback per Mux spec
      exp: now + ttlSeconds,
      kid: keyId,
    };

    const encodedHeader = this.base64url(JSON.stringify(header));
    const encodedPayload = this.base64url(JSON.stringify(payload));
    const signingInput = `${encodedHeader}.${encodedPayload}`;

    // TODO: Mux signing keys are distributed as base64-encoded PEM private keys.
    // Confirm the exact decoding/format (PKCS#8 vs PKCS#1) for your Mux key and
    // adjust if `createSign` rejects it. This assumes a base64-encoded PEM.
    const privateKeyPem = Buffer.from(privateKeyB64, 'base64').toString('utf8');

    const signer = createSign('RSA-SHA256');
    signer.update(signingInput);
    signer.end();
    const signature = this.base64url(signer.sign(privateKeyPem));

    return `${signingInput}.${signature}`;
  }
}
