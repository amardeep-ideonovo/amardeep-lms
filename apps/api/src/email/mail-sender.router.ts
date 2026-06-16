import { Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { SmtpMailSender } from './smtp.sender';
import { ResendMailSender } from './resend.sender';
import type { MailSender, OutboundMail } from './mail-sender.interface';

// The active MailSender, chosen at call time from the email.provider setting
// ('smtp' default | 'resend'). Bound to the MAIL_SENDER token so EmailService
// stays provider-agnostic. Because the lookup happens per send/isConfigured
// (not at construction), switching providers in the admin takes effect at
// runtime without a restart — matching each sender's stateless-per-send design.
@Injectable()
export class MailSenderRouter implements MailSender {
  constructor(
    private readonly settings: SettingsService,
    private readonly smtp: SmtpMailSender,
    private readonly resend: ResendMailSender,
  ) {}

  private async active(): Promise<MailSender> {
    const provider = await this.settings.getEmailProvider();
    return provider === 'resend' ? this.resend : this.smtp;
  }

  async send(msg: OutboundMail): Promise<{ providerId: string }> {
    return (await this.active()).send(msg);
  }

  async isConfigured(): Promise<boolean> {
    return (await this.active()).isConfigured();
  }
}
