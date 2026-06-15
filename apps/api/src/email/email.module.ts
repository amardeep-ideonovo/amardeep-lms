import { Global, Module } from '@nestjs/common';
import { AppConfigService } from '../site/app-config.service';
import { EmailService } from './email.service';
import { SmtpMailSender } from './smtp.sender';
import { MAIL_SENDER } from './mail-sender.interface';

// Global so any feature (Auth welcome mail, future automations/campaigns) can
// inject EmailService without importing this module. The active MailSender is
// bound to SmtpMailSender via the MAIL_SENDER token — swap that one provider to
// change transport. AppConfigService is provided locally (SiteModule doesn't
// export it) for the sender's default From name; it's a stateless reader over
// the global PrismaService, so a second instance is harmless.
@Global()
@Module({
  providers: [
    EmailService,
    SmtpMailSender,
    AppConfigService,
    { provide: MAIL_SENDER, useExisting: SmtpMailSender },
  ],
  exports: [EmailService],
})
export class EmailModule {}
