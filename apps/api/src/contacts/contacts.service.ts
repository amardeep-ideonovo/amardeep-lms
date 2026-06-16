import {
  Inject,
  Injectable,
  Logger,
  forwardRef,
} from '@nestjs/common';
import { Prisma, type Contact, type ContactSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { makeConfirmToken, verifyConfirmToken } from './confirm-token.util';

// Absolute base for the public confirm link. Same precedence as
// email.service.ts apiBaseUrl(): PUBLIC_API_URL (prod), then API_BASE_URL (email
// spec), then localhost for dev — trailing slash stripped.
function apiBaseUrl(): string {
  return (
    process.env.PUBLIC_API_URL?.replace(/\/$/, '') ||
    process.env.API_BASE_URL?.replace(/\/$/, '') ||
    'http://localhost:3000'
  );
}

// In-house list management — the DB-backed replacement for MailchimpService.
// Audiences/contacts/tags/merge-fields live in OUR database (system-of-record).
// Public methods mirror the old MailchimpService so the call-sites are a
// drop-in addition (dual-write) until the cutover. During the transition the
// call-sites still pass Mailchimp list ids; resolveAudienceId() maps those to
// (or provisions) an internal Audience via Audience.externalId.
@Injectable()
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);

  // EmailService comes from the @Global EmailModule (which ContactsModule
  // imports). EmailModule does NOT import ContactsModule so there is no cycle;
  // forwardRef is here purely as belt-and-braces in case Nest's @Global
  // resolution order ever flags one — it's harmless when no cycle exists.
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => EmailService))
    private readonly email: EmailService,
  ) {}

  private norm(email: string): string {
    return email.trim().toLowerCase();
  }

  /**
   * The single default audience, created on first use so contacts are never
   * dropped. Uses an upsert on the unique `slug` ('members') so two concurrent
   * first-signups can't both pass a findFirst miss and race to create (which
   * would throw P2002 on the slug). The upsert is keyed on slug because slug is
   * the only unique column that the default audience reliably owns.
   */
  async ensureDefaultAudience(): Promise<{ id: string }> {
    const existing = await this.prisma.audience.findFirst({
      where: { isDefault: true },
      select: { id: true },
    });
    if (existing) return existing;
    return this.prisma.audience.upsert({
      where: { slug: 'members' },
      create: { name: 'Members', slug: 'members', isDefault: true },
      // A concurrent caller that won the create already set the flag; a no-op
      // update just returns the surviving row.
      update: {},
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
      // Unknown ref during the transition → treat as an external Mailchimp id and
      // mint an audience for it (dual-write must never drop a contact).
      // TODO(post-cutover): once Mailchimp is retired, dual-write call-sites no
      // longer pass external list ids — an unknown ref here is then almost
      // certainly stale config, so the caller should fall back to the default
      // audience (ensureDefaultAudience) rather than mint an orphan "Audience
      // xxxx". Left as-is for now so the transition keeps capturing everyone;
      // changing it means updating the call-sites, which is out of this lane.
      const made = await this.prisma.audience.create({
        data: { name: opts.name ?? `Audience ${ref.slice(0, 8)}`, externalId: ref },
        select: { id: true },
      });
      return made.id;
    }
    return (await this.ensureDefaultAudience()).id;
  }

  /**
   * Upsert a member contact and link the User. Used by add-tag / signup /
   * billing / levels paths. On CREATE the contact is born SUBSCRIBED (a member
   * record) and an OPTIN consent is recorded. On UPDATE we only ever (re)link
   * the User — crucially we DO NOT re-subscribe: an UNSUBSCRIBED/CLEANED contact
   * that opted out must stay suppressed even though a downstream member action
   * (a new tag, a billing event) touched it. We don't use prisma.upsert here
   * because the create branch needs to fire a consent record only when a row is
   * actually created.
   */
  private async upsertContact(
    audienceId: string,
    email: string,
    opts: { userId?: string; source?: ContactSource } = {},
  ): Promise<Contact> {
    const e = this.norm(email);
    const existing = await this.prisma.contact.findUnique({
      where: { audienceId_email: { audienceId, email: e } },
    });
    if (existing) {
      // Only (re)link the User if asked; never touch status — leaving an
      // opted-out contact suppressed (no opt-out resurrection).
      if (opts.userId && existing.userId !== opts.userId) {
        return this.prisma.contact.update({
          where: { id: existing.id },
          data: { userId: opts.userId },
        });
      }
      return existing;
    }
    const created = await this.prisma.contact.create({
      data: {
        audienceId,
        email: e,
        status: 'SUBSCRIBED',
        source: opts.source ?? 'SIGNUP',
        userId: opts.userId ?? null,
        confirmedAt: new Date(),
      },
    });
    // New member contact = a fresh opt-in; record the consent trail.
    await this.recordConsent(created.id, 'OPTIN', opts.source);
    return created;
  }

  // Append to the consent audit trail. Best-effort (a consent write must never
  // break the business flow that triggered it) but no longer SILENT: a failure
  // is logged so a broken trail is visible in the logs instead of vanishing.
  // `ip` is threaded onto the (currently otherwise-unused) ConsentEvent.ip
  // column when the caller can supply it cheaply (e.g. the confirm endpoint).
  private async recordConsent(
    contactId: string,
    kind: 'OPTIN' | 'CONFIRM' | 'UNSUBSCRIBE' | 'COMPLAINT' | 'CLEANED',
    source?: string,
    ip?: string | null,
  ): Promise<void> {
    try {
      await this.prisma.consentEvent.create({
        data: { contactId, kind, source, ip: ip ?? null },
      });
    } catch (e) {
      this.logger.warn(
        `recordConsent(${kind}) failed for contact ${contactId}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
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
   * MailchimpService.changeEmail). Local data lets us be exhaustive. When the new
   * email already exists in the same audience we can't just rename (it would hit
   * the [audienceId,email] unique), and we must NOT leave the old-email row
   * lying around (the old behaviour `continue`d, leaving a stale duplicate that
   * could resurface). Instead we MERGE old → existing in a transaction: union
   * tags, keep the more-subscribed status, carry userId/attributes onto the
   * survivor, then delete the stale old-email row. When there's no clash the
   * rename proceeds as before.
   */
  async changeEmail(oldEmail: string, newEmail: string): Promise<void> {
    const from = this.norm(oldEmail);
    const to = this.norm(newEmail);
    if (from === to) return;
    const rows = await this.prisma.contact.findMany({
      where: { email: from },
    });
    for (const r of rows) {
      const clash = await this.prisma.contact.findUnique({
        where: { audienceId_email: { audienceId: r.audienceId, email: to } },
      });
      if (!clash) {
        await this.prisma.contact.update({
          where: { id: r.id },
          data: { email: to },
        });
        continue;
      }
      // Collision in this audience → merge the old row into the surviving
      // new-email row, then remove the old one. Both writes in one transaction
      // so we never end up with two rows (or none).
      const status = this.moreSubscribed(clash.status, r.status);
      const tags = Array.from(new Set([...clash.tags, ...r.tags]));
      const attributes = {
        ...(r.attributes as Record<string, unknown>),
        ...(clash.attributes as Record<string, unknown>),
      } as Prisma.InputJsonValue;
      await this.prisma.$transaction([
        this.prisma.contact.update({
          where: { id: clash.id },
          data: {
            status,
            tags,
            attributes,
            // Carry forward identity/confirmation from the old row only when the
            // survivor is missing them (don't clobber the survivor's own data).
            userId: clash.userId ?? r.userId,
            firstName: clash.firstName ?? r.firstName,
            lastName: clash.lastName ?? r.lastName,
            confirmedAt: clash.confirmedAt ?? r.confirmedAt,
          },
        }),
        this.prisma.contact.delete({ where: { id: r.id } }),
      ]);
    }
  }

  // Pick the "more subscribed" of two statuses for a merge: an active state wins
  // over a suppressed one (we'd rather keep someone reachable than silently drop
  // them), but a hard CLEANED/UNSUBSCRIBED on EITHER side is NOT downgraded to
  // SUBSCRIBED — opt-out always sticks. Order of preference, most→least active:
  // SUBSCRIBED > PENDING, and any suppressed state (UNSUBSCRIBED/CLEANED) wins
  // over an active one so a merge can never resurrect an opt-out.
  private moreSubscribed(
    a: Contact['status'],
    b: Contact['status'],
  ): Contact['status'] {
    const suppressed: Contact['status'][] = ['UNSUBSCRIBED', 'CLEANED'];
    // If either side opted out, the survivor stays opted out (CLEANED is the
    // hardest, so it wins over UNSUBSCRIBED).
    if (a === 'CLEANED' || b === 'CLEANED') return 'CLEANED';
    if (suppressed.includes(a)) return a;
    if (suppressed.includes(b)) return b;
    // Neither suppressed → prefer the fully-subscribed over a pending opt-in.
    if (a === 'SUBSCRIBED' || b === 'SUBSCRIBED') return 'SUBSCRIBED';
    return a;
  }

  /**
   * Subscribe/update a contact on a specific audience (mirrors
   * MailchimpService.subscribe). doubleOptIn → PENDING + a confirmation email
   * (see sendConfirmationEmail); the contact only becomes SUBSCRIBED once the
   * confirm link is clicked (see confirm()). updateExisting=false leaves an
   * existing contact untouched.
   *
   * Return value is honest about what happened:
   *  - 'subscribed' — created or re-activated as SUBSCRIBED
   *  - 'pending'    — created or moved to PENDING (awaiting confirmation)
   *  - 'existing'   — a row already existed and updateExisting=false
   *  - 'suppressed' — the contact stayed UNSUBSCRIBED/CLEANED (we did NOT
   *                   resurrect an opt-out, even with updateExisting=true)
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
  ): Promise<'subscribed' | 'pending' | 'existing' | 'suppressed'> {
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

      const mergedAttrs = {
        ...(existing.attributes as Record<string, unknown>),
        ...attrs,
      } as Prisma.InputJsonValue;
      const mergedTags = opts.tags?.length
        ? Array.from(new Set([...existing.tags, ...opts.tags]))
        : existing.tags;

      // CLEANED is a hard suppression (hard bounce / complaint) — never
      // resurrect it. Update attributes/tags for record-keeping but leave the
      // status suppressed and report it honestly.
      if (existing.status === 'CLEANED') {
        await this.prisma.contact.update({
          where: { id: existing.id },
          data: { attributes: mergedAttrs, tags: mergedTags },
        });
        return 'suppressed';
      }

      // UNSUBSCRIBED → a genuine re-opt-in. Transition back to SUBSCRIBED (or
      // PENDING under double opt-in) AND record a fresh OPTIN consent so the
      // trail shows the re-subscribe. (Previously this silently kept the
      // UNSUBSCRIBED row while returning 'subscribed' — the resurrection bug.)
      if (existing.status === 'UNSUBSCRIBED') {
        const reactivated = await this.prisma.contact.update({
          where: { id: existing.id },
          data: {
            status,
            attributes: mergedAttrs,
            tags: mergedTags,
            // Clear the old unsubscribe marker; set confirmedAt only when this
            // immediately re-subscribes (double opt-in waits for confirm()).
            unsubscribedAt: null,
            confirmedAt: status === 'SUBSCRIBED' ? new Date() : null,
          },
        });
        await this.recordConsent(reactivated.id, 'OPTIN', opts.source);
        if (opts.doubleOptIn) {
          await this.sendConfirmationEmail(e, audienceId);
        }
        return opts.doubleOptIn ? 'pending' : 'subscribed';
      }

      // Already SUBSCRIBED or PENDING → just merge attributes/tags. Don't
      // downgrade a SUBSCRIBED contact to PENDING just because this call asked
      // for double opt-in; they're already confirmed.
      await this.prisma.contact.update({
        where: { id: existing.id },
        data: { attributes: mergedAttrs, tags: mergedTags },
      });
      if (existing.status === 'PENDING') return 'pending';
      return 'subscribed';
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
    // A PENDING contact is NOT suppressed (suppression only covers
    // UNSUBSCRIBED/CLEANED), so the confirmation email is deliverable.
    if (opts.doubleOptIn) {
      await this.sendConfirmationEmail(e, audienceId);
    }
    return opts.doubleOptIn ? 'pending' : 'subscribed';
  }

  // ───────────────────────── double opt-in ─────────────────────────

  /**
   * Send the double-opt-in confirmation email for a PENDING contact. Best-effort
   * (wrapped in try/catch) so a mail hiccup never breaks subscribe() —
   * EmailService.send() already never throws, but we guard anyway in case the
   * token build or anything around it does. The confirm link points at the
   * public GET /contacts/confirm endpoint with a signed token carrying both the
   * email and the audience it's pending on.
   */
  private async sendConfirmationEmail(
    email: string,
    audienceId: string,
  ): Promise<void> {
    try {
      const token = makeConfirmToken(email, audienceId);
      const confirmUrl = `${apiBaseUrl()}/contacts/confirm?token=${token}`;
      const html = this.confirmEmailHtml(confirmUrl);
      await this.email.send({
        to: email,
        subject: 'Confirm your subscription',
        html,
        // One confirm mail per (audience, email) — a re-trigger is idempotent.
        dedupeKey: `confirm:${audienceId}:${email}`,
      });
    } catch (e) {
      this.logger.warn(
        `confirmation email failed for ${email}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  // Minimal inline confirmation email body. Kept self-contained (no template
  // dependency) so it works before any EmailTemplate exists; styling mirrors the
  // violet glass palette used by the unsubscribe page.
  private confirmEmailHtml(confirmUrl: string): string {
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;padding:24px;background:#f5f3fc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#251f3d;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;padding:36px 32px;border:1px solid rgba(124,92,252,0.12);">
    <h1 style="font-size:21px;margin:0 0 12px;color:#251f3d;">Confirm your subscription</h1>
    <p style="font-size:15px;line-height:1.6;color:#5a5470;margin:0 0 24px;">
      Thanks for signing up! Please confirm your email address to start receiving our emails.
    </p>
    <p style="margin:0 0 24px;">
      <a href="${confirmUrl}" style="display:inline-block;background:#7c5cfc;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 24px;border-radius:10px;">Confirm subscription</a>
    </p>
    <p style="font-size:13px;line-height:1.6;color:#8b84a4;margin:0;">
      If you didn't request this, you can safely ignore this email — you won't be subscribed.
    </p>
  </div>
</body></html>`;
  }

  /**
   * Confirm a PENDING contact from a signed token (the target of the
   * confirmation email's link). Idempotent and safe to call with anything:
   *  - bad/forged token → 'invalid'
   *  - no matching contact → 'invalid' (neutral; never leak which addresses exist)
   *  - already SUBSCRIBED → 'already' (success, no error)
   *  - PENDING → flip to SUBSCRIBED + confirmedAt + a CONFIRM consent → 'confirmed'
   *  - UNSUBSCRIBED/CLEANED → 'suppressed' (don't re-open an opt-out via a stale
   *    confirm link)
   * `ip` is threaded onto the consent record when available.
   */
  async confirm(
    token: string | undefined | null,
    ip?: string | null,
  ): Promise<{
    result: 'confirmed' | 'already' | 'suppressed' | 'invalid';
    email?: string;
  }> {
    const data = verifyConfirmToken(token);
    if (!data) return { result: 'invalid' };

    const e = this.norm(data.email);
    const contact = await this.prisma.contact.findUnique({
      where: { audienceId_email: { audienceId: data.audienceId, email: e } },
    });
    if (!contact) return { result: 'invalid' };

    if (contact.status === 'SUBSCRIBED') {
      // Idempotent: a second click on the same link is a no-op success.
      return { result: 'already', email: e };
    }
    if (contact.status === 'UNSUBSCRIBED' || contact.status === 'CLEANED') {
      // A confirm link must never re-open an opt-out.
      return { result: 'suppressed', email: e };
    }

    // PENDING → confirmed.
    await this.prisma.contact.update({
      where: { id: contact.id },
      data: { status: 'SUBSCRIBED', confirmedAt: new Date() },
    });
    await this.recordConsent(contact.id, 'CONFIRM', 'confirm-link', ip);
    return { result: 'confirmed', email: e };
  }
}
