// Sentry instrumentation. MUST be imported before any other application
// module so the SDK can patch http/express/db at require-time. Importing
// `./instrument` at the top of main.ts is what loads this file.
//
// No-op when SENTRY_DSN is unset: Sentry.init({}) without a DSN is a
// documented no-op (events are dropped at the SDK boundary), so this file
// is safe to ship in environments without observability configured.
import * as Sentry from '@sentry/nestjs';

const dsn = process.env.SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.ENV_NAME ?? 'production',
    // 10% transaction sampling — adjust via Sentry dashboard, not code.
    tracesSampleRate: 0.1,
    // SENTRY_RELEASE env var (set at deploy time, e.g. the git SHA)
    // tags events with a release; left to the deploy script to populate.
  });
}
