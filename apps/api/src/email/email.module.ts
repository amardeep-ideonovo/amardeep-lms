import {
  Global,
  Module,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppConfigService } from '../site/app-config.service';
import { EmailService } from './email.service';
import { EmailTemplateService } from './email-template.service';
import { CampaignService } from './campaign.service';
import { AutomationService } from './automation.service';
import { SchedulerService } from './scheduler.service';
import { EmailController } from './email.controller';
import { SmtpMailSender } from './smtp.sender';
import { MAIL_SENDER } from './mail-sender.interface';

// Global so any feature (Auth welcome mail, automations, campaigns) can inject
// EmailService / AutomationService / CampaignService without importing this
// module. The active MailSender is bound to SmtpMailSender via the MAIL_SENDER
// token — swap that one provider to change transport. AppConfigService is
// provided locally (SiteModule doesn't export it) for the sender's default From
// name and the campaign `brand` var; it's a stateless reader over the global
// PrismaService, so a second instance is harmless. ScheduleModule.forRoot()
// powers SchedulerService's per-minute campaign tick. EmailController exposes the
// admin template/campaign/automation surfaces.
@Global()
@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [
    EmailService,
    EmailTemplateService,
    CampaignService,
    AutomationService,
    SchedulerService,
    SmtpMailSender,
    AppConfigService,
    { provide: MAIL_SENDER, useExisting: SmtpMailSender },
  ],
  controllers: [EmailController],
  exports: [
    EmailService,
    EmailTemplateService,
    CampaignService,
    AutomationService,
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
