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

// ---------- Migration export shapes (Mailchimp → in-house importer) ----------
// A single Mailchimp member, flattened to the fields the importer maps from.
export interface MailchimpExportMember {
  email: string;
  status: string; // subscribed | pending | unsubscribed | cleaned | archived
  mergeFields: Record<string, unknown>; // raw merge_fields (EMAIL stripped by the importer)
  tags: string[]; // tag names only
}
// One Mailchimp audience (list) with its merge fields and ALL members — the
// full snapshot the one-time importer pulls into our internal contact system.
export interface MailchimpExportAudience {
  id: string; // Mailchimp list id (== Audience.externalId)
  name: string;
  mergeFields: { tag: string; name: string; type: string; required: boolean }[];
  members: MailchimpExportMember[];
}

@Injectable()
export class MailchimpService {
  private readonly logger = new Logger(MailchimpService.name);

  constructor(private readonly settings: SettingsService) {}

  // Resolve the target audience: the level's own audience (override) when set,
  // else the single global Settings audience. Returns null (skip) if Mailchimp
  // isn't configured or no audience can be determined.
  private async resolveAudience(
    override?: string,
  ): Promise<{ audienceId: string } | null> {
    const [apiKey, server, globalAudience] = await Promise.all([
      this.settings.getMailchimpApiKey(),
      this.settings.getMailchimpServerPrefix(),
      this.settings.getMailchimpAudienceId(),
    ]);
    const audienceId = override || globalAudience;
    if (!apiKey || !server || !audienceId) {
      this.logger.warn('Mailchimp not fully configured — skipping sync');
      return null;
    }
    mailchimp.setConfig({ apiKey, server });
    return { audienceId };
  }

  /**
   * Idempotently upsert the member on the target audience (the level's own
   * audience when provided, else the global one), then add/remove one or more
   * tags in a single call. Mailchimp's tag endpoint is itself idempotent. A
   * `remove` with no tags is a no-op — we never auto-unsubscribe a contact.
   */
  async syncTags(
    type: 'add' | 'remove',
    email: string,
    tags: string[],
    audienceId?: string,
  ): Promise<void> {
    const clean = (tags ?? []).map((t) => t.trim()).filter(Boolean);
    if (type === 'remove' && clean.length === 0) return; // nothing to deactivate
    const cfg = await this.resolveAudience(audienceId);
    if (!cfg) return;
    const hash = subscriberHash(email);

    // Ensure the contact exists on the audience (no-op if already present).
    await mailchimp.lists.setListMember(cfg.audienceId, hash, {
      email_address: email.toLowerCase(),
      status_if_new: 'subscribed',
    });

    if (clean.length) {
      await mailchimp.lists.updateListMemberTags(cfg.audienceId, hash, {
        tags: clean.map((name) => ({
          name,
          status: type === 'add' ? 'active' : 'inactive',
        })),
      });
    }
  }

  /**
   * Re-key a contact's email on every audience it may belong to — the global
   * Settings audience plus the supplied per-level audience ids. Uses the OLD
   * email's subscriber hash as the path id and PATCHes the new address, so we
   * never create a duplicate at the new email. A 404 means the contact isn't on
   * that audience — skipped. Other errors propagate so the job retries.
   * No-op when Mailchimp isn't configured.
   */
  async changeEmail(
    oldEmail: string,
    newEmail: string,
    perLevelAudienceIds: string[],
  ): Promise<void> {
    const [apiKey, server, globalAudience] = await Promise.all([
      this.settings.getMailchimpApiKey(),
      this.settings.getMailchimpServerPrefix(),
      this.settings.getMailchimpAudienceId(),
    ]);
    if (!apiKey || !server) {
      this.logger.warn('Mailchimp not configured — skipping email change');
      return;
    }
    mailchimp.setConfig({ apiKey, server });

    const audiences = Array.from(
      new Set(
        [globalAudience, ...perLevelAudienceIds].filter(
          (a): a is string => !!a,
        ),
      ),
    );
    if (audiences.length === 0) return;

    const oldHash = subscriberHash(oldEmail);
    const nextEmail = newEmail.trim().toLowerCase();

    for (const audienceId of audiences) {
      try {
        await mailchimp.lists.updateListMember(audienceId, oldHash, {
          email_address: nextEmail,
        });
      } catch (e: any) {
        const status = e?.status ?? e?.response?.status;
        if (status === 404) continue; // not on this audience — nothing to migrate
        this.logger.error(
          `[mailchimp] email change failed on audience ${audienceId}: ${
            e?.response?.body?.detail ?? e?.message ?? e
          }`,
        );
        throw e; // let the job retry
      }
    }
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
   * Full export of every audience for the one-time migration into the in-house
   * contact system: each list with its merge fields and ALL members (paginated
   * 1000 at a time until total_items is reached). Per member we capture the
   * email, status, raw merge fields and tag names. Throws a clear
   * BadRequestException (same message as the rest of this service) when
   * Mailchimp isn't configured, so the importer can surface it to the admin.
   */
  async exportAudiences(): Promise<MailchimpExportAudience[]> {
    await this.requireBase();

    const listsRes = await mailchimp.lists.getAllLists({ count: 100 });
    const lists: any[] = listsRes.lists ?? [];
    const out: MailchimpExportAudience[] = [];

    for (const list of lists) {
      // Merge fields for this list (EMAIL is the address itself — not returned
      // here; the importer skips it explicitly anyway).
      const fieldsRes = await mailchimp.lists.getListMergeFields(list.id, {
        count: 100,
      });
      const mergeFields = (fieldsRes.merge_fields ?? []).map((m: any) => ({
        tag: m.tag,
        name: m.name,
        type: m.type,
        required: !!m.required,
      }));

      // All members, paged 1000 at a time until we've fetched total_items.
      const members: MailchimpExportMember[] = [];
      let offset = 0;
      // total_items is reported on every page; default to one page if absent.
      // The loop stops as soon as a page comes back empty (defensive).
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const page = await mailchimp.lists.getListMembersInfo(list.id, {
          count: 1000,
          offset,
        });
        const batch: any[] = page.members ?? [];
        for (const m of batch) {
          members.push({
            email: m.email_address,
            status: m.status,
            mergeFields: (m.merge_fields ?? {}) as Record<string, unknown>,
            tags: ((m.tags ?? []) as { id?: number; name?: string }[])
              .map((t) => t?.name)
              .filter((n): n is string => !!n),
          });
        }
        offset += 1000;
        const total = page.total_items ?? members.length;
        if (batch.length === 0 || offset >= total) break;
      }

      out.push({ id: list.id, name: list.name, mergeFields, members });
    }

    return out;
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
