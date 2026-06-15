import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { SettingsService } from '../settings/settings.service';
import { AppConfigService } from '../site/app-config.service';
import type { MailSender, OutboundMail } from './mail-sender.interface';

// Default mail transport: SMTP via nodemailer, configured entirely from the
// stored email settings (host/port/user/pass/secure) with the From header
// derived from email.fromName/fromEmail (fromName falls back to the app title).
// Stateless: a fresh transport is created per send so a settings change in the
// admin takes effect immediately without a restart.
@Injectable()
export class SmtpMailSender implements MailSender {
  private readonly logger = new Logger(SmtpMailSender.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly appConfig: AppConfigService,
  ) {}

  // Minimum to attempt SMTP: a host and a username. (Port/secure have defaults,
  // and the From address falls back to the user when fromEmail is unset.)
  async isConfigured(): Promise<boolean> {
    const [host, user] = await Promise.all([
      this.settings.getEmailHost(),
      this.settings.getEmailUser(),
    ]);
    return !!host && !!user;
  }

  // Resolve "<fromName> <fromEmail>", falling back fromName→app title and
  // fromEmail→the SMTP username (a sane envelope sender for most providers).
  private async resolveFrom(): Promise<string> {
    const [fromEmailRaw, fromNameRaw, user] = await Promise.all([
      this.settings.getEmailFromEmail(),
      this.settings.getEmailFromName(),
      this.settings.getEmailUser(),
    ]);
    const fromEmail = fromEmailRaw || user || '';
    let fromName = fromNameRaw;
    if (!fromName) {
      const cfg = await this.appConfig.read();
      fromName = cfg.title;
    }
    return fromName ? `${fromName} <${fromEmail}>` : fromEmail;
  }

  async send(msg: OutboundMail): Promise<{ providerId: string }> {
    const [host, port, user, pass, secure] = await Promise.all([
      this.settings.getEmailHost(),
      this.settings.getEmailPort(),
      this.settings.getEmailUser(),
      this.settings.getEmailPass(),
      this.settings.getEmailSecure(),
    ]);

    const transport = nodemailer.createTransport({
      host: host ?? undefined,
      port,
      secure, // true for 465 (implicit TLS); false uses STARTTLS on 587
      auth: user ? { user, pass: pass ?? undefined } : undefined,
    });

    const from = msg.from || (await this.resolveFrom());
    const info = await transport.sendMail({
      from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      // Native one-click unsubscribe: nodemailer renders `list.unsubscribe`
      // into a `List-Unsubscribe` header (the bare URL form) so Gmail/Apple Mail
      // show an "Unsubscribe" button. Any extra raw headers pass through verbatim.
      ...(msg.listUnsubscribe
        ? { list: { unsubscribe: msg.listUnsubscribe } }
        : {}),
      ...(msg.headers ? { headers: msg.headers } : {}),
    });
    return { providerId: info.messageId };
  }
}
