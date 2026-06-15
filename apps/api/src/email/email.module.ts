import {
  Global,
  Module,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { AppConfigService } from '../site/app-config.service';
import { EmailService } from './email.service';
import { EmailTemplateService } from './email-template.service';
import { EmailController } from './email.controller';
import { SmtpMailSender } from './smtp.sender';
import { MAIL_SENDER } from './mail-sender.interface';

// Global so any feature (Auth welcome mail, future automations/campaigns) can
// inject EmailService / EmailTemplateService without importing this module. The
// active MailSender is bound to SmtpMailSender via the MAIL_SENDER token — swap
// that one provider to change transport. AppConfigService is provided locally
// (SiteModule doesn't export it) for the sender's default From name; it's a
// stateless reader over the global PrismaService, so a second instance is
// harmless. EmailController exposes the admin template CRUD + live-editor tools.
@Global()
@Module({
  providers: [
    EmailService,
    EmailTemplateService,
    SmtpMailSender,
    AppConfigService,
    { provide: MAIL_SENDER, useExisting: SmtpMailSender },
  ],
  controllers: [EmailController],
  exports: [EmailService, EmailTemplateService],
})
export class EmailModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(EmailModule.name);

  constructor(private readonly templates: EmailTemplateService) {}

  // Idempotently ensure the built-in system templates (welcome, …) exist on
  // boot, so the welcome mail always has a template even on a fresh/no-reseed
  // DB. ensureSystemTemplates() swallows its own errors; this guard is belt-and-
  // braces so a DB blip can never block application startup.
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.templates.ensureSystemTemplates();
    } catch (err) {
      this.logger.warn(
        `system email template bootstrap failed: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }
}
