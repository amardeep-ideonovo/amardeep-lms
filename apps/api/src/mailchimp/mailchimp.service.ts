import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { SettingsService } from '../settings/settings.service';

// Mailchimp Marketing client is CommonJS with a singleton config — we set the
// key/server per call to support runtime reconfiguration from the admin UI.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mailchimp = require('@mailchimp/mailchimp_marketing');

function subscriberHash(email: string): string {
  return createHash('md5').update(email.trim().toLowerCase()).digest('hex');
}

@Injectable()
export class MailchimpService {
  private readonly logger = new Logger(MailchimpService.name);

  constructor(private readonly settings: SettingsService) {}

  private async configure(): Promise<{ audienceId: string } | null> {
    const [apiKey, server, audienceId] = await Promise.all([
      this.settings.getMailchimpApiKey(),
      this.settings.getMailchimpServerPrefix(),
      this.settings.getMailchimpAudienceId(),
    ]);
    if (!apiKey || !server || !audienceId) {
      this.logger.warn('Mailchimp not fully configured — skipping sync');
      return null;
    }
    mailchimp.setConfig({ apiKey, server });
    return { audienceId };
  }

  /**
   * Idempotently upsert the member (PUT by subscriber hash, status_if_new
   * "subscribed") then add or remove a tag. Mailchimp's tag endpoint is itself
   * idempotent — adding an existing tag or removing an absent one is a no-op.
   */
  async syncTag(type: 'add' | 'remove', email: string, tag: string): Promise<void> {
    const cfg = await this.configure();
    if (!cfg) return;
    const hash = subscriberHash(email);

    // Ensure the contact exists (no-op if already present).
    await mailchimp.lists.setListMember(cfg.audienceId, hash, {
      email_address: email.toLowerCase(),
      status_if_new: 'subscribed',
    });

    await mailchimp.lists.updateListMemberTags(cfg.audienceId, hash, {
      tags: [{ name: tag, status: type === 'add' ? 'active' : 'inactive' }],
    });
  }
}
