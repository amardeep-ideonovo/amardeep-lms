import type { JwtPayload } from './jwt-payload.interface';

// Short-lived, single-purpose tokens for the `?token=` file-download path.
//
// A mobile client opens a download URL in the device browser (via Linking),
// where it can't attach an Authorization header, so the token has to ride in
// the query string. Putting the long-lived (7-day) SESSION JWT there leaks a
// full-account credential into server access logs, browser history, the Referer
// header, and error trackers. Instead the client fetches one of these tokens
// from an authenticated endpoint (header auth) and puts THAT in the URL:
//   • lifetime is minutes, not days;
//   • it is scoped to a single resource (a specific note / certificate);
//   • it carries `typ: 'dl'`, and JwtDownloadStrategy rejects any query-string
//     token that isn't a `dl` token whose scope matches the route.
export const DOWNLOAD_TOKEN_TTL_SECONDS = 180; // 3 minutes

export type DownloadScope = string; // `note:<lessonId>:<noteId>` | `cert:<id>`

export function noteDownloadScope(lessonId: string, noteId: string): DownloadScope {
  return `note:${lessonId}:${noteId}`;
}

export function certDownloadScope(certId: string): DownloadScope {
  return `cert:${certId}`;
}

// A download token carries only what the download path needs — the subject and
// the admin flag (for the lock-bypass + ownership checks) plus the purpose
// marker and resource scope. It deliberately OMITS member PII (email/username):
// this token rides in a `?token=` URL that reaches browser history, the OS share
// sheet, and server logs, so it must not leak identity.
export interface DownloadTokenPayload
  extends Omit<JwtPayload, 'email' | 'username'> {
  typ: 'dl';
  scope: DownloadScope;
}

export function isDownloadTokenPayload(
  p: JwtPayload | DownloadTokenPayload,
): p is DownloadTokenPayload {
  return (p as DownloadTokenPayload).typ === 'dl';
}
