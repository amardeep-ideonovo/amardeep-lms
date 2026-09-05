import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { SentryModule } from "@sentry/nestjs/setup";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { HttpExceptionFilter } from "./common/http-exception.filter";
import { ThrottlerModule } from "@nestjs/throttler";
import { PrismaModule } from "./prisma/prisma.module";
import { AuditModule } from "./audit/audit.module";
import { GlobalThrottlerGuard } from "./common/global-throttler.guard";
import { QueueModule } from "./queue/queue.module";
import { SettingsModule } from "./settings/settings.module";
import { ContactsModule } from "./contacts/contacts.module";
import { EmailModule } from "./email/email.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { AuthModule } from "./auth/auth.module";
import { AdminsModule } from "./admins/admins.module";
import { LevelsModule } from "./levels/levels.module";
import { CouponsModule } from "./coupons/coupons.module";
import { MembersModule } from "./members/members.module";
import { AccountModule } from "./account/account.module";
import { SubscriptionsModule } from "./subscriptions/subscriptions.module";
import { MediaModule } from "./media/media.module";
import { BillingModule } from "./billing/billing.module";
import { LmsModule } from "./lms/lms.module";
import { BlogModule } from "./blog/blog.module";
import { PagesModule } from "./pages/pages.module";
import { FormsModule } from "./forms/forms.module";
import { PopupsModule } from "./popups/popups.module";
import { CertificatesModule } from "./certificates/certificates.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { SearchModule } from "./search/search.module";
import { MenusModule } from "./menus/menus.module";
import { SiteModule } from "./site/site.module";
import { ReportsModule } from "./reports/reports.module";
import { ProjectsModule } from "./projects/projects.module";
import { LiveModule } from "./live/live.module";
import { SupportModule } from "./support/support.module";
import { HelpdeskModule } from "./helpdesk/helpdesk.module";
import { HealthModule } from "./health/health.module";
import { ControlPlaneModule } from "./control-plane/control-plane.module";
import { ContentPackModule } from "./content-pack/content-pack.module";
import { SitePreviewModule } from "./site-preview/site-preview.module";
import { PreviewReadOnlyGuard } from "./site-preview/preview-read-only.guard";
import { CsrfGuard } from "./auth/csrf.guard";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Sentry global exception filter — captures unhandled errors and
    // attaches HTTP request context. No-op if SENTRY_DSN is unset (see
    // ./instrument.ts).
    SentryModule.forRoot(),
    // App-wide rate limit (generous — only catches egregious abuse; the tight
    // per-route caps on auth/forms/live still apply on top). Keyed on the real
    // client IP by GlobalThrottlerGuard below. Marked global so feature modules'
    // own ThrottlerGuards (e.g. LiveThrottlerGuard) resolve without re-importing.
    {
      ...ThrottlerModule.forRoot([
        { name: "default", ttl: 60_000, limit: 1000 },
      ]),
      global: true,
    },
    // Global infrastructure modules.
    PrismaModule,
    // @Global — lets any service emit best-effort signals up to the control
    // plane (e.g. "the admin changed their own password") without importing the
    // support module that owns the ticket half of the same channel.
    ControlPlaneModule,
    AuditModule,
    QueueModule,
    SettingsModule,
    ContactsModule,
    EmailModule,
    NotificationsModule,
    // Feature modules.
    HealthModule,
    AuthModule,
    AdminsModule,
    BillingModule,
    LevelsModule,
    CouponsModule,
    MembersModule,
    AccountModule,
    SubscriptionsModule,
    MediaModule,
    LmsModule,
    BlogModule,
    PagesModule,
    FormsModule,
    PopupsModule,
    CertificatesModule,
    DashboardModule,
    SearchModule,
    MenusModule,
    SiteModule,
    ReportsModule,
    ProjectsModule,
    LiveModule,
    SupportModule,
    HelpdeskModule,
    ContentPackModule,
    SitePreviewModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: GlobalThrottlerGuard },
    // Read-only guard for admin "preview member" sessions: 403s any write verb
    // carrying a preview JWT, so the synthetic preview users can never mutate
    // data (keeps their "no relational rows" isolation invariant). Runs on
    // every request; cheap (verb allowlist + one HMAC decode only when needed).
    { provide: APP_GUARD, useClass: PreviewReadOnlyGuard },
    // CSRF (double-submit) for the cookie-authenticated web session. No-ops for
    // safe methods, Bearer clients (mobile/admin), and requests with no session
    // cookie (public routes + webhooks), so it only guards real cookie sessions.
    { provide: APP_GUARD, useClass: CsrfGuard },
    // D6: every HTTP error body carries a machine-readable `code`
    // ("UNSPECIFIED" for legacy string-only throws) — one response shape.
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
