import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type ContactStatus } from '@prisma/client';
import type { ImportSummary } from '@lms/types';
import { PrismaService } from '../prisma/prisma.service';
import {
  MailchimpService,
  type MailchimpExportMember,
} from '../mailchimp/mailchimp.service';

// EMAIL is the address itself, not a real merge field — never stored as an
// attribute or imported as an audience field. FNAME/LNAME (with their common
// aliases) are lifted onto the dedicated firstName/lastName columns but are
// ALSO kept in attributes (so the raw merge data round-trips).
const EMAIL_TAG = 'EMAIL';
const FIRST_NAME_TAGS = ['FNAME', 'FIRSTNAME'];
const LAST_NAME_TAGS = ['LNAME', 'LASTNAME'];

// The Contact fields the importer writes — the shape produced by the pure
// mapper below and consumed by the upsert.
export interface MappedContactData {
  audienceId: string;
  email: string;
  status: ContactStatus;
  firstName: string | null;
  lastName: string | null;
  attributes: Record<string, unknown>;
  tags: string[];
  source: 'IMPORT';
  confirmedAt: Date | null;
}

// Map a Mailchimp member status to our ContactStatus. `cleaned` and `archived`
// both land on CLEANED (never-mail-again); anything unexpected defaults to
// SUBSCRIBED so a live contact is never silently dropped.
function mapStatus(raw: string | undefined): ContactStatus {
  switch ((raw ?? '').toLowerCase()) {
    case 'subscribed':
      return 'SUBSCRIBED';
    case 'pending':
      return 'PENDING';
    case 'unsubscribed':
      return 'UNSUBSCRIBED';
    case 'cleaned':
    case 'archived':
      return 'CLEANED';
    default:
      return 'SUBSCRIBED';
  }
}

// Case-insensitively pick the first present merge-field value for any of the
// given tags, returning a trimmed non-empty string or null.
function pickName(
  mergeFields: Record<string, unknown>,
  tags: string[],
): string | null {
  for (const [k, v] of Object.entries(mergeFields)) {
    if (tags.includes(k.toUpperCase()) && typeof v === 'string') {
      const t = v.trim();
      if (t) return t;
    }
  }
  return null;
}

/**
 * PURE, exported, unit-testable mapping from a Mailchimp member to our Contact
 * data. No DB, no Mailchimp, no clock except `now` (defaults to new Date()):
 *  - email lowercased/trimmed
 *  - status mapped (subscribed/pending/unsubscribed/cleaned|archived)
 *  - firstName from FNAME/FIRSTNAME, lastName from LNAME/LASTNAME
 *  - attributes = merge_fields with EMAIL removed
 *  - tags = member tag names
 *  - source IMPORT; confirmedAt = now when SUBSCRIBED, else null
 */
export function mapMemberToContactData(
  member: MailchimpExportMember,
  audienceId: string,
  now: Date = new Date(),
): MappedContactData {
  const merge = member.mergeFields ?? {};
  // attributes = merge fields minus the implicit EMAIL (any casing).
  const attributes: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(merge)) {
    if (k.toUpperCase() === EMAIL_TAG) continue;
    attributes[k] = v;
  }
  const status = mapStatus(member.status);
  return {
    audienceId,
    email: (member.email ?? '').trim().toLowerCase(),
    status,
    firstName: pickName(merge, FIRST_NAME_TAGS),
    lastName: pickName(merge, LAST_NAME_TAGS),
    attributes,
    tags: Array.from(
      new Set((member.tags ?? []).map((t) => t?.trim()).filter(Boolean)),
    ) as string[],
    source: 'IMPORT',
    confirmedAt: status === 'SUBSCRIBED' ? now : null,
  };
}

// One-time migration importer: pulls the existing Mailchimp audience(s) into
// the in-house contact system. Idempotent — re-running upserts (audiences by
// externalId, fields by [audienceId,tag], contacts by [audienceId,email]) and
// never creates duplicates. Lives in the (global) ContactsModule and injects
// the global MailchimpService for the export side.
@Injectable()
export class ContactsImportService {
  private readonly logger = new Logger(ContactsImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailchimp: MailchimpService,
  ) {}

  // Append an OPTIN consent record for a freshly-imported subscribed contact.
  // Best-effort but logs on failure (a broken trail must be visible, not
  // silent) — mirrors ContactsService.recordConsent.
  private async recordConsent(
    contactId: string,
    source?: string,
  ): Promise<void> {
    try {
      await this.prisma.consentEvent.create({
        data: { contactId, kind: 'OPTIN', source: source ?? null },
      });
    } catch (e: any) {
      this.logger.warn(
        `recordConsent failed for imported contact ${contactId}: ${
          e?.message ?? String(e)
        }`,
      );
    }
  }

  /**
   * Import every Mailchimp audience into our DB. Throws (via the export call) a
   * BadRequestException when Mailchimp isn't configured. Each audience is
   * wrapped in try/catch so one bad list never aborts the whole run; failures
   * are collected into `errors`. Returns aggregate counts.
   */
  async importFromMailchimp(): Promise<ImportSummary> {
    // exportAudiences() throws BadRequestException("Mailchimp is not
    // configured…") when creds are missing — we let that propagate (the import
    // can't run at all without them).
    const exported = await this.mailchimp.exportAudiences();

    const summary: ImportSummary = {
      audiences: 0,
      fields: 0,
      contactsCreated: 0,
      contactsUpdated: 0,
      errors: [],
    };

    for (const aud of exported) {
      try {
        // 1) Upsert the internal Audience by externalId (the Mailchimp list id).
        //    Never set isDefault — imports must not steal the default flag.
        const audience = await this.prisma.audience.upsert({
          where: { externalId: aud.id },
          create: { name: aud.name, externalId: aud.id },
          update: { name: aud.name },
          select: { id: true },
        });
        summary.audiences += 1;

        // 2) Upsert each merge field as an AudienceField, skipping EMAIL.
        for (const f of aud.mergeFields) {
          const tag = (f.tag ?? '').trim().toUpperCase();
          if (!tag || tag === EMAIL_TAG) continue;
          await this.prisma.audienceField.upsert({
            where: { audienceId_tag: { audienceId: audience.id, tag } },
            create: {
              audienceId: audience.id,
              tag,
              label: f.name?.trim() || tag,
              type: f.type?.trim() || 'text',
              required: !!f.required,
            },
            update: {
              label: f.name?.trim() || tag,
              type: f.type?.trim() || 'text',
              required: !!f.required,
            },
          });
          summary.fields += 1;
        }

        // 3) Upsert each member as a Contact (key [audienceId,email]).
        for (const member of aud.members) {
          const data = mapMemberToContactData(member, audience.id);
          if (!data.email) continue; // skip malformed rows with no address

          const existing = await this.prisma.contact.findUnique({
            where: {
              audienceId_email: {
                audienceId: audience.id,
                email: data.email,
              },
            },
            select: { id: true },
          });

          if (existing) {
            await this.prisma.contact.update({
              where: { id: existing.id },
              data: {
                status: data.status,
                firstName: data.firstName,
                lastName: data.lastName,
                attributes: data.attributes as Prisma.InputJsonValue,
                tags: data.tags,
                source: data.source,
                confirmedAt: data.confirmedAt,
              },
            });
            summary.contactsUpdated += 1;
            // Re-running the import shouldn't re-stamp consent for a contact
            // that's already on file — only record on first import (create).
          } else {
            const created = await this.prisma.contact.create({
              data: {
                audienceId: data.audienceId,
                email: data.email,
                status: data.status,
                firstName: data.firstName,
                lastName: data.lastName,
                attributes: data.attributes as Prisma.InputJsonValue,
                tags: data.tags,
                source: data.source,
                confirmedAt: data.confirmedAt,
              },
            });
            summary.contactsCreated += 1;
            // Record the consent trail for each newly-imported SUBSCRIBED
            // contact (the opt-in carried over from Mailchimp). PENDING/
            // UNSUBSCRIBED/CLEANED rows didn't (re)consent here, so we skip them.
            if (data.status === 'SUBSCRIBED') {
              await this.recordConsent(created.id, 'import');
            }
          }
        }
      } catch (e: any) {
        const reason = e?.message ?? String(e);
        this.logger.error(
          `Mailchimp import failed for audience "${aud.name}" (${aud.id}): ${reason}`,
        );
        summary.errors.push(`${aud.name}: ${reason}`);
      }
    }

    return summary;
  }
}
