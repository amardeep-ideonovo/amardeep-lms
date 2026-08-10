import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { CertificatesModule } from '../certificates/certificates.module';
import { MediaModule } from '../media/media.module';
import { AccountDeletionService } from './account-deletion.service';
import { AccountController } from './account.controller';

// Member account deletion (store-required). Reuses BillingService to cancel
// subscriptions, CertificatesService to unlink PDFs, and MediaStorage to remove
// avatars. Exports the service so MembersModule can offer the same purge as an
// admin action. Prisma / Notifications are global.
@Module({
  imports: [BillingModule, CertificatesModule, MediaModule],
  providers: [AccountDeletionService],
  controllers: [AccountController],
  exports: [AccountDeletionService],
})
export class AccountModule {}
