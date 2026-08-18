import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import type { DeleteAccountSummaryDTO } from "@lms/types";
import { PrismaService } from "../prisma/prisma.service";
import { BillingService } from "../billing/billing.service";
import { CertificatesService } from "../certificates/certificates.service";
import { NotificationsService } from "../notifications/notifications.service";
import { MediaStorage } from "../media/media.storage";
import { MEDIA_ROUTE } from "../media/media.config";

// Who initiated the deletion — a member erasing themselves (self) or an admin
// acting on the member's behalf (admin, for GDPR requests / support).
type Actor = { kind: "self" } | { kind: "admin"; adminId: string };

/**
 * Member account deletion — a HARD, irreversible purge that both app stores
 * require (Apple 5.1.1(v), Google Play account-deletion policy).
 *
 * The ordering is load-bearing and was derived from a three-agent audit of the
 * billing / email / auth subsystems:
 *
 *  1. Cancel every provider subscription FIRST, while the row still exists.
 *     After the cascade there is no way to find a PayPal sub (UserLevel is its
 *     only index) or a Stripe customer (stripeCustomerId lives only on User),
 *     and the lifecycle webhooks silently no-op on a missing user — so a
 *     surviving subscription would bill forever, invisibly. A cancel failure
 *     ABORTS the deletion (409); we never delete a still-billing member.
 *  2. Tombstone email identity instead of deleting it: Contacts are kept but
 *     unsubscribed (suppression is an OR over Contact.status and User.emailOptOut
 *     — dropping either arm makes the address mailable again), and any queued
 *     automation mail is canceled.
 *  3. Delete the User last, inside a transaction, cascading UserLevel /
 *     LessonProgress / Certificate. The row's absence instantly
 *     invalidates every JWT (JwtStrategy re-checks the row per request) and
 *     kills outstanding password-reset tokens (they fingerprint the row).
 *  4. Unlink on-disk files (certificate PDFs bake in the member's name; avatar)
 *     AFTER commit — best-effort; a leaked file beats a failed erasure.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly certificates: CertificatesService,
    private readonly notifications: NotificationsService,
    private readonly storage: MediaStorage,
  ) {}

  /**
   * The "what you'll lose" summary shown before the member confirms. Assembled
   * from their real data so the warning is honest, not boilerplate. Every field
   * is commonly empty — the UI renders only the categories that apply.
   */
  async summaryFor(userId: string): Promise<DeleteAccountSummaryDTO> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("Member not found");

    const [subscriptions, certificates, lifetimeLevelRows, completedLessons] =
      await Promise.all([
        this.billing.getMySubscriptionDetails(userId),
        this.certificates.mine(userId),
        this.prisma.userLevel.findMany({
          where: { userId, lifetime: true },
          include: { level: { select: { name: true } } },
        }),
        this.prisma.lessonProgress.count({ where: { userId } }),
      ]);

    const lifetimeLevels = lifetimeLevelRows.map((ul) => ({
      levelId: ul.levelId,
      levelName: ul.level.name,
    }));

    return {
      email: user.email,
      subscriptions,
      certificates,
      lifetimeLevels,
      completedLessons,
      hasPaymentHistory:
        !!user.stripeCustomerId ||
        subscriptions.length > 0 ||
        lifetimeLevels.length > 0,
    };
  }

  /**
   * Execute the purge. For self-service (`password` provided) the password is
   * re-verified as a second factor; the admin path skips it. Idempotent-ish: a
   * missing user is a 404 (already gone).
   */
  async deleteMember(
    userId: string,
    opts: { password?: string; actor: Actor },
  ): Promise<{ ok: true }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("Member not found");

    if (opts.password !== undefined) {
      const ok = await bcrypt.compare(opts.password, user.passwordHash);
      if (!ok) throw new BadRequestException("Password is incorrect");
    }

    // 1) Cancel all subscriptions at the provider first. A failure here must
    //    stop the whole deletion — orphaning a live subscription is the one
    //    outcome we can never recover from.
    try {
      await this.billing.cancelAllSubscriptionsForDeletion(userId);
    } catch (err) {
      this.logger.error(
        `[account-deletion] subscription cancel failed for ${userId}; ` +
          `aborting deletion: ${err instanceof Error ? err.message : err}`,
      );
      throw new ConflictException(
        "We could not automatically cancel your active subscription, so your " +
          "account was NOT deleted. Please try again in a few minutes, or " +
          "contact your academy for help.",
      );
    }

    // 2) Collect on-disk file references BEFORE the cascade removes their rows.
    const certRows = await this.prisma.certificate.findMany({
      where: { userId },
      select: { fileKey: true },
    });
    const certFileKeys = certRows.map((c) => c.fileKey);
    const avatarUrl = user.avatarUrl;
    const email = user.email;

    // 3) Purge in one transaction. External provider calls already happened
    //    above — nothing here reaches the network, so the 5s interactive-tx
    //    budget is safe. A concurrent double-delete loses the P2025 race on the
    //    terminal user.delete; the tx is atomic, so the loser rolls back wholly
    //    and we treat it as already-deleted (idempotent success) below.
    try {
      await this.prisma.$transaction(async (tx) => {
        // a) Email identity -> suppression tombstones. Never delete the Contact:
        //    the address must stay un-mailable even after a re-import/re-signup.
        const contacts = await tx.contact.findMany({ where: { email } });
        for (const c of contacts) {
          await tx.contact.update({
            where: { id: c.id },
            data: {
              userId: null,
              status: "UNSUBSCRIBED",
              unsubscribedAt: new Date(),
              firstName: null,
              lastName: null,
              attributes: {},
              tags: [],
            },
          });
          await tx.consentEvent.create({
            data: {
              contactId: c.id,
              kind: "UNSUBSCRIBE",
              source: "account-deletion",
            },
          });
        }

        // a2) Preserve an EXISTING opt-out that lived only on the User row. If
        //     the member had unsubscribed (emailOptOut) but was never in an
        //     audience (no Contact above), deleting the User would erase the
        //     only suppression signal — isSuppressed() ORs Contact.status with
        //     User.emailOptOut, and both arms would vanish, making the address
        //     mailable again on any future import. Materialize a suppressed
        //     tombstone Contact so the opt-out survives. Only for opted-out
        //     members — we never newly-suppress someone who never opted out.
        if (user.emailOptOut && contacts.length === 0) {
          const audience = await tx.audience.findFirst({
            where: { isDefault: true },
            select: { id: true },
          });
          if (audience) {
            const tombstone = await tx.contact.create({
              data: {
                audienceId: audience.id,
                email,
                status: "UNSUBSCRIBED",
                source: "MANUAL",
                unsubscribedAt: new Date(),
              },
            });
            await tx.consentEvent.create({
              data: {
                contactId: tombstone.id,
                kind: "UNSUBSCRIBE",
                source: "account-deletion",
              },
            });
          }
        }

        // b) Cancel queued automation mail to this address (it has no
        //    user-existence check and would otherwise still send).
        await tx.scheduledEmail.updateMany({
          where: { to: email, status: "PENDING" },
          data: { status: "CANCELED" },
        });

        // c) Redact the member's email from historical admin-notification
        //    bodies and drop the now-dead deep-link.
        const notes = await tx.adminNotification.findMany({
          where: { userId },
          select: { id: true, body: true },
        });
        for (const n of notes) {
          await tx.adminNotification.update({
            where: { id: n.id },
            data: {
              userId: null,
              body: n.body.split(email).join("[deleted member]"),
            },
          });
        }

        // d) Anonymize the surviving subscription mirrors (kept for the
        //    org-wide admin list; provider ids retained, owner dropped).
        await tx.subscriptionMirror.updateMany({
          where: { userId },
          data: { userId: null },
        });

        // e) Finally delete the member — cascades UserLevel /
        //    LessonProgress / Certificate.
        await tx.user.delete({ where: { id: userId } });
      });
    } catch (err) {
      // Concurrent double-delete: another request already purged this user, so
      // the terminal delete found no row. The account is gone either way —
      // report success (idempotent) rather than a spurious 500.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2025"
      ) {
        this.logger.log(
          `[account-deletion] ${userId} already deleted (concurrent) — no-op`,
        );
        return { ok: true };
      }
      throw err;
    }

    // 4) Best-effort file cleanup (post-commit; a leaked file never blocks
    //    erasure).
    await this.certificates.unlinkCertificateFiles(certFileKeys);
    await this.deleteAvatarFile(avatarUrl);

    // 5) Leave an admin record of the erasure (the notification body is the only
    //    place the email now legitimately survives — as the request record).
    const who =
      opts.actor.kind === "admin"
        ? `by an admin (${opts.actor.adminId})`
        : "by the member";
    try {
      await this.notifications.record({
        type: "MEMBER_DELETED",
        severity: "INFO",
        title: "Member account deleted",
        body: `${email} deleted their account ${who}. All data was purged and any subscription canceled.`,
        userId: null,
        dedupeKey: `member-deleted:${userId}`,
      });
    } catch (err) {
      this.logger.warn(
        `[account-deletion] admin notification failed for ${userId}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }

    this.logger.log(`[account-deletion] purged member ${userId} (${who})`);
    return { ok: true };
  }

  // Delete a stored avatar file (best effort). Mirrors AuthService: only removes
  // keys we generated (avatar-*), so it can never touch gallery media. Marked
  // used via the tx cleanup above.
  private async deleteAvatarFile(url: string | null): Promise<void> {
    if (!url) return;
    const marker = `${MEDIA_ROUTE}/`;
    const idx = url.indexOf(marker);
    if (idx === -1) return;
    const key = url.slice(idx + marker.length);
    if (key.startsWith("avatar-")) {
      await this.storage.delete(key).catch(() => undefined);
    }
  }
}
