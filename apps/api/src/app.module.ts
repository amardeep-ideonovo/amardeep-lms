import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SentryModule } from '@sentry/nestjs/setup';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { GlobalThrottlerGuard } from './common/global-throttler.guard';
import { QueueModule } from './queue/queue.module';
import { SettingsModule } from './settings/settings.module';
import { ContactsModule } from './contacts/contacts.module';
import { EmailModule } from './email/email.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AuthModule } from './auth/auth.module';
import { AdminsModule } from './admins/admins.module';
import { LevelsModule } from './levels/levels.module';
import { CouponsModule } from './coupons/coupons.module';
import { MembersModule } from './members/members.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { MediaModule } from './media/media.module';
import { BillingModule } from './billing/billing.module';
import { LmsModule } from './lms/lms.module';
import { BlogModule } from './blog/blog.module';
import { PagesModule } from './pages/pages.module';
import { FormsModule } from './forms/forms.module';
import { PopupsModule } from './popups/popups.module';
import { CertificatesModule } from './certificates/certificates.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { SearchModule } from './search/search.module';
import { MenusModule } from './menus/menus.module';
import { SiteModule } from './site/site.module';
import { ReportsModule } from './reports/reports.module';
import { ProjectsModule } from './projects/projects.module';
import { LiveModule } from './live/live.module';
import { SupportModule } from './support/support.module';
import { HealthModule } from './health/health.module';

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
        { name: 'default', ttl: 60_000, limit: 1000 },
      ]),
      global: true,
    },
    // Global infrastructure modules.
    PrismaModule,
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
  ],
  providers: [{ provide: APP_GUARD, useClass: GlobalThrottlerGuard }],
})
export class AppModule {}
