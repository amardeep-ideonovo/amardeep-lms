import { Injectable, Logger } from '@nestjs/common';
import type { ConsentKind, ContactStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Suppression engine shared by the public unsubscribe page and the provider
// webhook. Both end in the same place: every Contact on an email address moves
// to a suppressed status, the linked User is opted out, and a ConsentEvent is
// written per contact for the compliance audit trail. EmailService.isSuppressed
// already keys off exactly these signals (Contact UNSUBSCRIBED/CLEANED or
// User.emailOptOut), so applying them here is what actually stops future mail.
@Injectable()
export class UnsubscribeService {
  private readonly logger = new Logger(UnsubscribeService.name);

  constructor(private readonly prisma: PrismaService) {}

  // A member clicked "unsubscribe" (or one-click List-Unsubscribe). Soft opt-out:
  // status → UNSUBSCRIBED, unsubscribedAt set, User.emailOptOut=true, one
  // UNSUBSCRIBE consent row per contact. Returns how many contacts changed.
  async unsubscribeEmail(email: string, source = 'unsubscribe-link'): Promise<number> {
    return this.suppress(email, {
      status: 'UNSUBSCRIBED',
      consentKind: 'UNSUBSCRIBE',
      source,
      setUnsubscribedAt: true,
    });
  }

  // A hard bounce or spam complaint from the provider. status → CLEANED (never
  // mail again), User.emailOptOut=true, a COMPLAINT or CLEANED consent row per
  // contact. Returns how many contacts changed.
  async suppressFromEvent(
    email: string,
    reason: 'bounce' | 'complaint',
    source = 'webhook',
  ): Promise<number> {
    return this.suppress(email, {
      status: 'CLEANED',
      consentKind: reason === 'complaint' ? 'COMPLAINT' : 'CLEANED',
      // A complaint is also an unsubscribe at heart — stamp the timestamp too.
      setUnsubscribedAt: true,
      source,
    });
  }

  // Shared mutation. Idempotent and defensive: a normalized email with no
  // matching contacts still opts out any linked User and returns 0. Each contact
  // gets exactly one new consent row per call (the audit trail is append-only).
  private async suppress(
    rawEmail: string,
    opts: {
      status: ContactStatus;
      consentKind: ConsentKind;
      source: string;
      setUnsubscribedAt: boolean;
    },
  ): Promise<number> {
    const email = (rawEmail || '').trim().toLowerCase();
    if (!email) return 0;

    const now = new Date();
    const contacts = await this.prisma.contact.findMany({
      where: { email },
      select: { id: true },
    });

    await this.prisma.$transaction([
      // Flip every contact on this email to the suppressed status.
      this.prisma.contact.updateMany({
        where: { email },
        data: {
          status: opts.status,
          ...(opts.setUnsubscribedAt ? { unsubscribedAt: now } : {}),
        },
      }),
      // Mirror onto the member account (the global opt-out the welcome/automation
      // paths already respect), if one exists at this address.
      this.prisma.user.updateMany({
        where: { email },
        data: { emailOptOut: true },
      }),
      // One consent event per contact for compliance history.
      ...contacts.map((c) =>
        this.prisma.consentEvent.create({
          data: { contactId: c.id, kind: opts.consentKind, source: opts.source },
        }),
      ),
    ]);

    return contacts.length;
  }
}
