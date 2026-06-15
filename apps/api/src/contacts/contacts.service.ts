import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type Contact, type ContactSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// In-house list management — the DB-backed replacement for MailchimpService.
// Audiences/contacts/tags/merge-fields live in OUR database (system-of-record).
// Public methods mirror the old MailchimpService so the call-sites are a
// drop-in addition (dual-write) until the cutover. During the transition the
// call-sites still pass Mailchimp list ids; resolveAudienceId() maps those to
// (or provisions) an internal Audience via Audience.externalId.
@Injectable()
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private norm(email: string): string {
    return email.trim().toLowerCase();
  }

  /** The single default audience, created on first use so contacts are never dropped. */
  async ensureDefaultAudience(): Promise<{ id: string }> {
    const existing = await this.prisma.audience.findFirst({
      where: { isDefault: true },
      select: { id: true },
    });
    if (existing) return existing;
    return this.prisma.audience.create({
      data: { name: 'Members', slug: 'members', isDefault: true },
      select: { id: true },
    });
  }

  /**
   * Resolve a target audience by internal id OR external (Mailchimp) id, else
   * the default audience. With `create:false` (used by tag-removal) a missing
   * audience returns null instead of being provisioned.
   */
  private async resolveAudienceId(
    ref?: string | null,
    opts: { create?: boolean; name?: string } = {},
  ): Promise<string | null> {
    const create = opts.create ?? true;
    if (ref) {
      const found = await this.prisma.audience.findFirst({
        where: { OR: [{ id: ref }, { externalId: ref }] },
        select: { id: true },
      });
      if (found) return found.id;
      if (!create) return null;
      // Unknown ref during the transition → treat as an external Mailchimp id.
      const made = await this.prisma.audience.create({
        data: { name: opts.name ?? `Audience ${ref.slice(0, 8)}`, externalId: ref },
        select: { id: true },
      });
      return made.id;
    }
    return (await this.ensureDefaultAudience()).id;
  }

  /** Upsert a member contact and link the User. Used by add-tag / signup paths. */
  private async upsertContact(
    audienceId: string,
    email: string,
    opts: { userId?: string; source?: ContactSource } = {},
  ): Promise<Contact> {
    const e = this.norm(email);
    return this.prisma.contact.upsert({
      where: { audienceId_email: { audienceId, email: e } },
      create: {
        audienceId,
        email: e,
        status: 'SUBSCRIBED',
        source: opts.source ?? 'SIGNUP',
        userId: opts.userId ?? null,
        confirmedAt: new Date(),
      },
      update: opts.userId ? { userId: opts.userId } : {},
    });
  }

  private async recordConsent(
    contactId: string,
    kind: 'OPTIN' | 'CONFIRM' | 'UNSUBSCRIBE' | 'COMPLAINT' | 'CLEANED',
    source?: string,
  ): Promise<void> {
    try {
      await this.prisma.consentEvent.create({ data: { contactId, kind, source } });
    } catch {
      /* audit trail is best-effort */
    }
  }

  // ───────────────────────── parity API ─────────────────────────

  /**
   * Add/remove tags on a contact within an audience (mirrors
   * MailchimpService.syncTags). `add` upserts the contact; `remove` is a no-op
   * when the contact or audience is absent. We never auto-unsubscribe.
   */
  async syncTags(
    type: 'add' | 'remove',
    email: string,
    tags: string[],
    audienceRef?: string | null,
    opts: { userId?: string; source?: ContactSource } = {},
  ): Promise<void> {
    const clean = (tags ?? []).map((t) => t.trim()).filter(Boolean);
    if (type === 'remove' && clean.length === 0) return;
    const audienceId = await this.resolveAudienceId(audienceRef, {
      create: type === 'add',
    });
    if (!audienceId) return;
    const e = this.norm(email);

    if (type === 'add') {
      const contact = await this.upsertContact(audienceId, e, opts);
      const next = Array.from(new Set([...contact.tags, ...clean]));
      if (next.length !== contact.tags.length) {
        await this.prisma.contact.update({
          where: { id: contact.id },
          data: { tags: next },
        });
      }
    } else {
      const contact = await this.prisma.contact.findUnique({
        where: { audienceId_email: { audienceId, email: e } },
        select: { id: true, tags: true },
      });
      if (!contact) return;
      const next = contact.tags.filter((t) => !clean.includes(t));
      if (next.length !== contact.tags.length) {
        await this.prisma.contact.update({
          where: { id: contact.id },
          data: { tags: next },
        });
      }
    }
  }

  /**
   * Re-key a contact's email across every audience it belongs to (mirrors
   * MailchimpService.changeEmail). Local data lets us be exhaustive; we skip an
   * audience where the new email already exists to avoid a unique clash.
   */
  async changeEmail(oldEmail: string, newEmail: string): Promise<void> {
    const from = this.norm(oldEmail);
    const to = this.norm(newEmail);
    if (from === to) return;
    const rows = await this.prisma.contact.findMany({
      where: { email: from },
      select: { id: true, audienceId: true },
    });
    for (const r of rows) {
      const clash = await this.prisma.contact.findUnique({
        where: { audienceId_email: { audienceId: r.audienceId, email: to } },
        select: { id: true },
      });
      if (clash) continue;
      await this.prisma.contact.update({
        where: { id: r.id },
        data: { email: to },
      });
    }
  }

  /**
   * Subscribe/update a contact on a specific audience (mirrors
   * MailchimpService.subscribe). doubleOptIn → PENDING (confirmation wired in a
   * later phase); updateExisting=false leaves an existing contact untouched.
   */
  async subscribe(
    audienceRef: string | null,
    email: string,
    attributes: Record<string, unknown>,
    opts: {
      doubleOptIn: boolean;
      updateExisting: boolean;
      tags?: string[];
      source?: ContactSource;
      userId?: string;
    },
  ): Promise<'subscribed' | 'pending' | 'existing'> {
    const audienceId = (await this.resolveAudienceId(audienceRef))!;
    const e = this.norm(email);
    const attrs = Object.fromEntries(
      Object.entries(attributes ?? {}).filter(
        ([, v]) => v !== undefined && v !== null && v !== '',
      ),
    );
    const status = opts.doubleOptIn ? 'PENDING' : 'SUBSCRIBED';
    const existing = await this.prisma.contact.findUnique({
      where: { audienceId_email: { audienceId, email: e } },
    });

    if (existing) {
      if (!opts.updateExisting) return 'existing';
      await this.prisma.contact.update({
        where: { id: existing.id },
        data: {
          attributes: {
            ...(existing.attributes as Record<string, unknown>),
            ...attrs,
          } as Prisma.InputJsonValue,
          tags: opts.tags?.length
            ? Array.from(new Set([...existing.tags, ...opts.tags]))
            : existing.tags,
        },
      });
      return opts.doubleOptIn ? 'pending' : 'subscribed';
    }

    const created = await this.prisma.contact.create({
      data: {
        audienceId,
        email: e,
        status,
        attributes: attrs as Prisma.InputJsonValue,
        tags: opts.tags ?? [],
        source: opts.source ?? 'FORM',
        userId: opts.userId ?? null,
        firstName: typeof attrs.FNAME === 'string' ? attrs.FNAME : null,
        lastName: typeof attrs.LNAME === 'string' ? attrs.LNAME : null,
        confirmedAt: status === 'SUBSCRIBED' ? new Date() : null,
      },
    });
    await this.recordConsent(created.id, 'OPTIN', opts.source);
    return opts.doubleOptIn ? 'pending' : 'subscribed';
  }
}
