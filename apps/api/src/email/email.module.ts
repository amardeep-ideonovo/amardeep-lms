import {
  Global,
  Module,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppConfigService } from '../site/app-config.service';
import { EmailService } from './email.service';
import { EmailTemplateService } from './email-template.service';
import { CampaignService } from './campaign.service';
import { AutomationService } from './automation.service';
import { EmailLogService } from './email-log.service';
import { SchedulerService } from './scheduler.service';
import { EmailController } from './email.controller';
import { EmailWebhookController } from './email-webhook.controller';
import { UnsubscribeController } from './unsubscribe.controller';
import { UnsubscribeService } from './unsubscribe.service';
import { SmtpMailSender } from './smtp.sender';
import { ResendMailSender } from './resend.sender';
import { MailSenderRouter } from './mail-sender.router';
import { MAIL_SENDER } from './mail-sender.interface';

// Global so any feature (Auth welcome mail, automations, campaigns) can inject
// EmailService / AutomationService / CampaignService without importing this
// module. The active MailSender is bound to MailSenderRouter via the MAIL_SENDER
// token; the router picks SmtpMailSender or ResendMailSender per send from the
// email.provider setting, so flipping providers in the admin takes effect at
// runtime without a restart. Both concrete senders stay registered so the router
// can inject them. AppConfigService is
// provided locally (SiteModule doesn't export it) for the sender's default From
// name and the campaign `brand` var; it's a stateless reader over the global
// PrismaService, so a second instance is harmless. ScheduleModule.forRoot()
// powers SchedulerService's per-minute campaign tick. EmailController exposes the
// admin template/campaign/automation surfaces.
@Global()
@Module({
  imports: [
    ScheduleModule.forRoot(),
    // Local throttler so the public, unauthenticated controllers here
    // (UnsubscribeController, EmailWebhookController) can use ThrottlerGuard
    // without depending on AuthModule's instance — its forRoot providers aren't
    // exported. A second storage instance is harmless; per-route limits live on
    // the @Throttle decorators. Default is lenient so nothing else is affected.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 1000 }]),
  ],
  providers: [
    EmailService,
    EmailTemplateService,
    CampaignService,
    AutomationService,
    EmailLogService,
    SchedulerService,
    SmtpMailSender,
    ResendMailSender,
    MailSenderRouter,
    AppConfigService,
    UnsubscribeService,
    { provide: MAIL_SENDER, useExisting: MailSenderRouter },
  ],
  controllers: [EmailController, UnsubscribeController, EmailWebhookController],
  exports: [
    EmailService,
    EmailTemplateService,
    CampaignService,
    AutomationService,
    UnsubscribeService,
  ],
})
export class EmailModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(EmailModule.name);

  constructor(
    private readonly templates: EmailTemplateService,
    private readonly automations: AutomationService,
  ) {}

  // Idempotently ensure the built-in system templates (welcome, …) exist on
  // boot, then seed the system automations (the SIGNUP "Welcome" automation that
  // now sends the welcome mail — must run AFTER the template exists so it can
  // resolve the welcome template's id). Both helpers swallow their own errors;
  // this guard is belt-and-braces so a DB blip can never block startup.
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.templates.ensureSystemTemplates();
      await this.automations.ensureSystemAutomations();
    } catch (err) {
      this.logger.warn(
        `email bootstrap failed: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }
}
