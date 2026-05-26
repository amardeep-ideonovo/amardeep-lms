import { BadRequestException, Injectable, Logger } from '@nestjs/common';
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

  // ---------- Forms support (any audience; no preset audienceId needed) ----------

  // Configure with just the API key + server prefix (the one-time Settings).
  private async configureBase(): Promise<boolean> {
    const [apiKey, server] = await Promise.all([
      this.settings.getMailchimpApiKey(),
      this.settings.getMailchimpServerPrefix(),
    ]);
    if (!apiKey || !server) return false;
    mailchimp.setConfig({ apiKey, server });
    return true;
  }

  private async requireBase(): Promise<void> {
    if (!(await this.configureBase())) {
      throw new BadRequestException(
        'Mailchimp is not configured. Add the API key and server prefix in Settings → Mailchimp.',
      );
    }
  }

  // All audiences (lists) on the account — for the form editor's live dropdown.
  async listAudiences(): Promise<
    { id: string; name: string; memberCount: number }[]
  > {
    await this.requireBase();
    const res = await mailchimp.lists.getAllLists({ count: 100 });
    return (res.lists ?? []).map((l: any) => ({
      id: l.id,
      name: l.name,
      memberCount: l.stats?.member_count ?? 0,
    }));
  }

  // Merge fields for one audience — so the builder can map fields to real tags.
  async getMergeFields(
    audienceId: string,
  ): Promise<{ tag: string; name: string; type: string; required: boolean }[]> {
    await this.requireBase();
    const res = await mailchimp.lists.getListMergeFields(audienceId, {
      count: 100,
    });
    const fields = (res.merge_fields ?? []).map((m: any) => ({
      tag: m.tag,
      name: m.name,
      type: m.type,
      required: !!m.required,
    }));
    // EMAIL is the address itself (not a merge field) but is always mappable.
    if (!fields.some((f: { tag: string }) => f.tag === 'EMAIL')) {
      fields.unshift({
        tag: 'EMAIL',
        name: 'Email Address',
        type: 'email',
        required: true,
      });
    }
    return fields;
  }

  /**
   * Subscribe (or update) a contact on a SPECIFIC audience.
   *  - doubleOptIn   true  -> status_if_new "pending" (confirmation email)
   *                  false -> "subscribed"
   *  - updateExisting true  -> PUT upsert (updates an existing member's data)
   *                  false -> POST add-only (existing members are left untouched)
   * Throws BadRequestException if Mailchimp isn't configured.
   */
  async subscribe(
    audienceId: string,
    email: string,
    mergeFields: Record<string, unknown>,
    opts: { doubleOptIn: boolean; updateExisting: boolean; tags?: string[] },
  ): Promise<'subscribed' | 'pending' | 'existing'> {
    await this.requireBase();
    const hash = subscriberHash(email);
    const statusIfNew = opts.doubleOptIn ? 'pending' : 'subscribed';
    const merge_fields = Object.fromEntries(
      Object.entries(mergeFields).filter(
        ([, v]) => v !== undefined && v !== null && v !== '',
      ),
    );

    if (opts.updateExisting) {
      await mailchimp.lists.setListMember(audienceId, hash, {
        email_address: email.toLowerCase(),
        status_if_new: statusIfNew,
        merge_fields,
      });
    } else {
      try {
        await mailchimp.lists.addListMember(audienceId, {
          email_address: email.toLowerCase(),
          status: statusIfNew,
          merge_fields,
        });
      } catch (e: any) {
        const title = e?.response?.body?.title ?? e?.title;
        if (title === 'Member Exists') return 'existing';
        throw e;
      }
    }

    if (opts.tags?.length) {
      await mailchimp.lists.updateListMemberTags(audienceId, hash, {
        tags: opts.tags.map((name) => ({ name, status: 'active' })),
      });
    }
    return opts.doubleOptIn ? 'pending' : 'subscribed';
  }
}
