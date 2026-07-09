// Sentry instrumentation. MUST be imported before any other application
// module so the SDK can patch http/express/db at require-time. Importing
// `./instrument` at the top of main.ts is what loads this file.
//
// No-op when SENTRY_DSN is unset: Sentry.init({}) without a DSN is a
// documented no-op (events are dropped at the SDK boundary), so this file
// is safe to ship in environments without observability configured.
import * as Sentry from '@sentry/nestjs';

// Strip auth tokens from any URL/query string before it leaves for Sentry. The
// lesson-note + certificate download routes accept a `?token=` param, so a 4xx/
// 5xx on those routes would otherwise ship the token to Sentry via the captured
// request URL / breadcrumbs.
function redactTokens<T extends string | undefined>(url: T): T {
  if (!url) return url;
  return url.replace(
    /([?&](?:token|access_token)=)[^&#]*/gi,
    '$1[REDACTED]',
  ) as T;
}

const dsn = process.env.SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.ENV_NAME ?? 'production',
    // 10% transaction sampling — adjust via Sentry dashboard, not code.
    tracesSampleRate: 0.1,
    // SENTRY_RELEASE env var (set at deploy time, e.g. the git SHA)
    // tags events with a release; left to the deploy script to populate.
    beforeSend(event) {
      if (event.request?.url) event.request.url = redactTokens(event.request.url);
      if (typeof event.request?.query_string === 'string') {
        event.request.query_string = redactTokens(event.request.query_string);
      }
      return event;
    },
    beforeBreadcrumb(crumb) {
      if (crumb.data?.url && typeof crumb.data.url === 'string') {
        crumb.data.url = redactTokens(crumb.data.url);
      }
      return crumb;
    },
  });
}
