import { Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { AppConfigService } from '../site/app-config.service';
import type { MailSender, OutboundMail } from './mail-sender.interface';

// API-based mail transport: Resend's REST endpoint (POST /emails), called with
// the native global `fetch` (Node 18+) so it adds no dependency — mirroring the
// hand-rolled PayPalService REST client. Like SmtpMailSender it is stateless and
// reads the stored settings per send, so flipping email.provider in the admin
// takes effect immediately without a restart. The From header is derived from
// email.fromName/fromEmail (fromName falls back to the app title); Resend
// requires a verified-domain From, so unlike SMTP there is no username fallback.
@Injectable()
export class ResendMailSender implements MailSender {
  private readonly logger = new Logger(ResendMailSender.name);
  private static readonly ENDPOINT = 'https://api.resend.com/emails';

  constructor(
    private readonly settings: SettingsService,
    private readonly appConfig: AppConfigService,
  ) {}

  // Resend needs an API key AND a verified-domain From address. Without
  // fromEmail there is no valid sender (no username fallback like SMTP), so we
  // require both before claiming to be configured. EmailService short-circuits
  // to a FAILED log when this is false.
  async isConfigured(): Promise<boolean> {
    const [apiKey, fromEmail] = await Promise.all([
      this.settings.getEmailResendApiKey(),
      this.settings.getEmailFromEmail(),
    ]);
    return !!apiKey && !!fromEmail;
  }

  // Resolve "<fromName> <fromEmail>", falling back fromName→app title. Unlike
  // SMTP there is NO fromEmail fallback: Resend rejects sends from an
  // unverified domain, so the address must be configured explicitly.
  private async resolveFrom(): Promise<string> {
    const [fromEmailRaw, fromNameRaw] = await Promise.all([
      this.settings.getEmailFromEmail(),
      this.settings.getEmailFromName(),
    ]);
    const fromEmail = fromEmailRaw || '';
    let fromName = fromNameRaw;
    if (!fromName) {
      const cfg = await this.appConfig.read();
      fromName = cfg.title;
    }
    return fromName ? `${fromName} <${fromEmail}>` : fromEmail;
  }

  async send(msg: OutboundMail): Promise<{ providerId: string }> {
    const apiKey = await this.settings.getEmailResendApiKey();
    const from = msg.from || (await this.resolveFrom());

    // RFC 8058 one-click unsubscribe. Resend carries arbitrary headers via the
    // `headers` object, so both the bracketed List-Unsubscribe URL and the
    // List-Unsubscribe-Post token go there (merged ahead of any caller-supplied
    // headers so callers can still override).
    const headers: Record<string, string> = {
      ...(msg.listUnsubscribe
        ? {
            'List-Unsubscribe': `<${msg.listUnsubscribe}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          }
        : {}),
      ...(msg.headers ?? {}),
    };

    const res = await fetch(ResendMailSender.ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey ?? ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        ...(Object.keys(headers).length ? { headers } : {}),
      }),
    });

    if (!res.ok) {
      // Resend errors come back as { message, name, statusCode }. Surface the
      // status + message only — never the API key or request body — then throw
      // so EmailService records a FAILED EmailLog.
      const body = (await res.json().catch(() => null)) as {
        message?: string;
      } | null;
      const message = body?.message || res.statusText || 'unknown error';
      this.logger.warn(`Resend send failed: ${res.status} ${message}`);
      throw new Error(`Resend ${res.status}: ${message}`);
    }

    const body = (await res.json().catch(() => null)) as { id?: string } | null;
    if (!body?.id) {
      // A 2xx with no id means we can't correlate later webhooks (bounce/
      // complaint) — treat it as a failure rather than logging a SENT we can't track.
      this.logger.warn('Resend send succeeded but returned no message id');
      throw new Error('Resend: missing message id in response');
    }
    return { providerId: body.id };
  }
}
