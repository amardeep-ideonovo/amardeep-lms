import { SetMetadata } from "@nestjs/common";

// Mark a route as exempt from the double-submit CSRF check (see CsrfGuard).
// Used only for the session BOOTSTRAP/teardown routes (login, signup, forgot-
// and reset-password): they either create or precede a session, so requiring a
// pre-existing readable CSRF token would deadlock them — a member with a stale
// session cookie in the browser could never log in again (the guard would run
// but the web, on a different host, can't read the csrf_token cookie to echo
// it). These routes are safe to exempt: login-CSRF/session-fixation is a
// pre-existing property of any cookie-session design, SameSite=Lax already
// withholds the session cookie on cross-site POSTs, and login/signup were
// already CSRF-exempt whenever no session cookie was present. Logout is
// deliberately NOT exempt — the web can echo the token there, so keeping it
// guarded closes forced-logout CSRF at no cost.
export const SKIP_CSRF_KEY = "skipCsrf";
export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true);
