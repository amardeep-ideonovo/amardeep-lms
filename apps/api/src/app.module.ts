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
import { DashboardModule } from './dashboard/dashboard.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Global infrastructure modules.
    PrismaModule,
    QueueModule,
    SettingsModule,
    MailchimpModule,
    // Feature modules.
    AuthModule,
    BillingModule,
    LevelsModule,
    MembersModule,
    LmsModule,
    DashboardModule,
  ],
})
export class AppModule {}
