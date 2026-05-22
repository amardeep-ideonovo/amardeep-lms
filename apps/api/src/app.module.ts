import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
import { DashboardModule } from './dashboard/dashboard.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
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
    DashboardModule,
  ],
})
export class AppModule {}
