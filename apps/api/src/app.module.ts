import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SentryModule } from '@sentry/nestjs/setup';
import { PrismaModule } from './prisma/prisma.module';
import { QueueModule } from './queue/queue.module';
import { SettingsModule } from './settings/settings.module';
import { MailchimpModule } from './mailchimp/mailchimp.module';
import { AuthModule } from './auth/auth.module';
import { LevelsModule } from './levels/levels.module';
import { MembersModule } from './members/members.module';
import { BillingModule } from './billing/billing.module';
import { LmsModule } from './lms/lms.module';
import { BlogModule } from './blog/blog.module';
import { PagesModule } from './pages/pages.module';
import { FormsModule } from './forms/forms.module';
import { PopupsModule } from './popups/popups.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Sentry global exception filter — captures unhandled errors and
    // attaches HTTP request context. No-op if SENTRY_DSN is unset (see
    // ./instrument.ts).
    SentryModule.forRoot(),
    // Global infrastructure modules.
    PrismaModule,
    QueueModule,
    SettingsModule,
    MailchimpModule,
    // Feature modules.
    HealthModule,
    AuthModule,
    BillingModule,
    LevelsModule,
    MembersModule,
    LmsModule,
    BlogModule,
    PagesModule,
    FormsModule,
    PopupsModule,
    DashboardModule,
  ],
})
export class AppModule {}
