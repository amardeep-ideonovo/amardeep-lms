import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import type { Prisma } from "@prisma/client";
import {
  Expo,
  type ExpoPushMessage,
  type ExpoPushTicket,
} from "expo-server-sdk";
import { PrismaService } from "../prisma/prisma.service";
import { MemberNotificationsService } from "../notifications/member-notifications.service";
import type { RegisterDeviceTokenDto } from "./dto/register-device-token.dto";

// The member push categories. Kept as a local union (the API consumes
// @lms/types as TYPES only and cannot import runtime values from it).
export type PushCategory =
  | "helpdesk-reply"
  | "payment-failed"
  | "subscription-active"
  | "certificate-issued"
  | "certificate-ready"
  | "new-course"
  | "new-lesson"
  | "live-starting-soon"
  | "live-now";

export interface PushDispatchInput {
  userId: string;
  category: PushCategory;
  /** Notification body (the message). */
  body: string;
  /** Deep-link path handed to the app's openAppHref, e.g. "help/<id>". */
  href: string;
  /** Stable per-event key so a webhook replay / double-fire is a no-op. */
  dedupeKey: string;
  /** Notification title; defaults to the per-academy brand. */
  title?: string;
}

// A fan-out send to everyone entitled to a set of Classes (Levels), enqueued to
// the PushOutbox and delivered by the drain cron.
export interface PushFanoutInput {
  category: PushCategory;
  body: string;
  href: string;
  /** Per-event key; the per-recipient PushLog key is `<dedupePrefix>:<userId>`. */
  dedupePrefix: string;
  title?: string;
  /** true => all members with >=1 active grant (open-course / all-members). */
  broadcast?: boolean;
  /** When to send; defaults to now. Used to coalesce bursts (see below). */
  sendAt?: Date;
}

// Default tumbling window for coalesced fan-outs (new-lesson): bursts of adds to
// one course inside the same window collapse to a single delayed push.
export const COALESCE_WINDOW_MS = 15 * 60 * 1000;

// Expo recommends waiting ~15 min before fetching a delivery receipt, then a
// PENDING receipt Expo never returns is reaped after this age (a missing id
// means "not ready", so we only reap by age — see drainPushReceipts).
const RECEIPT_CHECK_DELAY_MS = 15 * 60 * 1000;
const RECEIPT_GIVE_UP_MS = 48 * 60 * 60 * 1000;

// A fan-out row that keeps failing (e.g. the inbox write) is retried this many
// times before it is parked as FAILED, so a permanently-bad row can't retry
// forever.
const MAX_OUTBOX_ATTEMPTS = 5;

// A device push token belongs to a live member (FK), and the batch send resolves
// the notification body once for the whole cohort.
interface DeliverPayload {
  category: PushCategory;
  body: string;
  href: string;
  title?: string;
}

// Billing/renewal push categories run through the anti-steering strip below.
const BILLING_CATEGORIES: ReadonlySet<PushCategory> = new Set<PushCategory>([
  "payment-failed",
  "subscription-active",
]);

// Store-compliance choke point: a billing/renewal push must never steer the
// member to a web purchase (Apple 3.1.1 / anti-steering). The copy is authored
// compliant; this strips any link defensively so it can never regress into a
// "renew on the web" CTA — full URLs, www.* hosts, and bare domains with a
// known TLD. Prices are a copy-review concern (stripping digits would mangle
// dates), so this only removes links; the TLD allowlist avoids eating "2.0".
function stripSteering(body: string): string {
  return body
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\bwww\.\S+/gi, "")
    .replace(
      /\b[a-z0-9-]+\.(?:com|net|org|io|co|app|dev|shop|store|academy|link|page)\b\S*/gi,
      "",
    )
    .replace(/\s{2,}/g, " ")
    .trim();
}

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  // EXPO_ACCESS_TOKEN is optional (adds enhanced push security); Expo push works
  // without it. useFcmV1 is the current Android transport.
  private readonly expo = new Expo({
    accessToken: process.env.EXPO_ACCESS_TOKEN,
    useFcmV1: true,
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly memberNotifications: MemberNotificationsService,
  ) {}

  // ---------- Registration (member-facing) ----------

  async register(
    userId: string,
    dto: RegisterDeviceTokenDto,
  ): Promise<{ ok: true }> {
    const token = dto.token.trim();
    if (!Expo.isExpoPushToken(token)) {
      // Don't 400 a login over a malformed token — just ignore it.
      this.logger.warn(`[push] ignoring non-Expo token for user ${userId}`);
      return { ok: true };
    }
    await this.prisma.deviceToken.upsert({
      where: { expoPushToken: token },
      // Re-register: the device may have changed hands (a different member on
      // the same phone) — reassign userId and re-enable a previously pruned row.
      // lastSeenAt is @updatedAt, refreshed automatically on this update.
      update: {
        userId,
        platform: dto.platform,
        appVersion: dto.appVersion ?? null,
        disabled: false,
      },
      create: {
        userId,
        expoPushToken: token,
        platform: dto.platform,
        appVersion: dto.appVersion ?? null,
      },
    });
    return { ok: true };
  }

  async unregister(userId: string, token: string): Promise<void> {
    // Scoped to userId so a member can only drop their own token; idempotent.
    await this.prisma.deviceToken.deleteMany({
      where: { expoPushToken: token.trim(), userId },
    });
  }

  // ---------- Dispatch (called at emit-sites) ----------

  // Best-effort: NEVER throws. Called from webhook reconcile paths and the
  // helpdesk reply flow, both of which must not 500 over a push failure.
  async dispatch(input: PushDispatchInput): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: input.userId },
        select: { pushOptOut: true },
      });
      if (!user) return;

      const title = (input.title ?? (await this.brandTitle())).trim();
      const body = BILLING_CATEGORIES.has(input.category)
        ? stripSteering(input.body)
        : input.body;

      // Durable inbox row FIRST — recorded even when the member opted out of OS
      // push or has no device, so the in-app inbox + badge are independent of
      // push delivery. Idempotent on dedupeKey.
      await this.memberNotifications.record({
        userId: input.userId,
        category: input.category,
        title,
        body,
        href: input.href,
        dedupeKey: input.dedupeKey,
      });

      if (user.pushOptOut) return; // inbox recorded; skip the OS push

      // Push idempotency: the unique dedupeKey collapses concurrent webhook
      // replays — the first create wins, any duplicate throws P2002 and we bail.
      try {
        await this.prisma.pushLog.create({
          data: {
            userId: input.userId,
            category: input.category,
            dedupeKey: input.dedupeKey,
          },
        });
      } catch {
        return; // duplicate dedupeKey — already sent
      }

      await this.deliverToUsers([input.userId], {
        category: input.category,
        body,
        href: input.href,
        title,
      });
    } catch (err) {
      this.logger.warn(
        `[push] dispatch ${input.category} failed for ${input.userId}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  // ---------- Fan-out (content / live) ----------

  // Enqueue a fan-out to everyone entitled to `levelIds` (best-effort). Returns
  // immediately — the minute-cron drain resolves the audience and sends, so the
  // admin publish / cron tick never blocks on ~500 recipients. Idempotent on
  // dedupePrefix: a re-enqueue of the same event is a no-op.
  async dispatchToLevels(
    levelIds: string[],
    input: PushFanoutInput,
  ): Promise<void> {
    // Fire-and-forget for content emit-sites (the boolean is for callers that
    // gate on a confirmed enqueue, e.g. the live cron's marker).
    await this.enqueueFanout(levelIds, input);
  }

  // Enqueue one fan-out row. Returns true when the row is present after the call
  // — created now OR already there (a unique-violation on dedupePrefix is an
  // idempotent success) — and false only on a transient error the caller may
  // retry. Never throws.
  async enqueueFanout(
    levelIds: string[],
    input: PushFanoutInput,
  ): Promise<boolean> {
    try {
      await this.prisma.pushOutbox.create({
        data: {
          category: input.category,
          title: input.title ?? null,
          body: input.body,
          href: input.href,
          levelIds,
          broadcast: input.broadcast ?? false,
          dedupePrefix: input.dedupePrefix,
          sendAt: input.sendAt,
        },
      });
      return true;
    } catch (err) {
      // P2002 = already enqueued (dedupePrefix unique) => idempotent success.
      const code = (err as { code?: unknown } | null)?.code;
      if (code === "P2002") return true;
      this.logger.warn(
        `[push] fan-out enqueue failed (${input.dedupePrefix}): ${
          err instanceof Error ? err.message : err
        }`,
      );
      return false;
    }
  }

  // Coalesced fan-out: bursts of the same event to one entity inside a tumbling
  // window collapse to ONE delayed push. Keys the row `<keyBase>:<bucket>` and
  // parks its sendAt at the bucket end, so the first add creates the row and
  // every later add in the window hits the unique key (a no-op — the body is
  // count-agnostic, e.g. "New lessons added to X"). Prevents a bulk lesson
  // upload from firing one push per lesson. `now` is injectable for tests.
  async dispatchToLevelsCoalesced(
    levelIds: string[],
    input: Omit<PushFanoutInput, "dedupePrefix" | "sendAt"> & {
      keyBase: string;
    },
    windowMs: number = COALESCE_WINDOW_MS,
    now: number = Date.now(),
  ): Promise<void> {
    const bucket = Math.floor(now / windowMs);
    await this.dispatchToLevels(levelIds, {
      category: input.category,
      body: input.body,
      href: input.href,
      title: input.title,
      broadcast: input.broadcast,
      dedupePrefix: `${input.keyBase}:${bucket}`,
      sendAt: new Date((bucket + 1) * windowMs),
    });
  }

  // Members entitled to ANY of `levelIds` (or, when broadcast, any member with
  // >=1 active grant), excluding preview members and push opt-outs. Mirrors the
  // access predicate (status ACTIVE AND not-expired) — a grant stays ACTIVE with
  // an expiresAt during dunning grace, so status alone would over-include.
  // Querying User (not UserLevel) dedupes to one id per member. Keyset-paged.
  private async resolveEntitledMembers(
    levelIds: string[],
    broadcast: boolean,
  ): Promise<{ id: string; pushOptOut: boolean }[]> {
    // A non-broadcast fan-out with no levels targets nobody (never everybody).
    if (!broadcast && levelIds.length === 0) return [];
    const now = new Date();
    const grant: Prisma.UserLevelWhereInput = broadcast
      ? {
          status: "ACTIVE",
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        }
      : {
          levelId: { in: levelIds },
          status: "ACTIVE",
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        };
    // NOTE: pushOptOut is NOT filtered here — opted-out members still get the
    // durable inbox row; the caller sends OS push only to the !pushOptOut subset.
    const base: Prisma.UserWhereInput = {
      isPreview: false,
      levels: { some: grant },
    };
    const members: { id: string; pushOptOut: boolean }[] = [];
    let cursor: string | undefined;
    for (;;) {
      // Pure keyset (id > cursor), NOT cursor+skip:1 — a value comparison that
      // stays correct even if the boundary member is deleted / expires between
      // pages (cursor+skip would then OFFSET past a real recipient).
      const page = await this.prisma.user.findMany({
        where: cursor ? { AND: [base, { id: { gt: cursor } }] } : base,
        select: { id: true, pushOptOut: true },
        orderBy: { id: "asc" },
        take: 1000,
      });
      if (page.length === 0) break;
      for (const u of page)
        members.push({ id: u.id, pushOptOut: u.pushOptOut });
      if (page.length < 1000) break;
      cursor = page[page.length - 1].id;
    }
    return members;
  }

  // Drain the fan-out outbox once a minute. Coexists with the email drains
  // (ScheduleModule is app-wide). Each row is CLAIMED with a guarded updateMany
  // (PENDING -> SENT) so an overlapping tick / second instance can't double-send;
  // only the worker that matched (count===1) proceeds. Marked SENT before the
  // send (like the email drain) because per-recipient PushLog rows are the
  // idempotency ledger and push is a best-effort supplement to the email.
  private draining = false;

  @Cron(CronExpression.EVERY_MINUTE)
  async drainPushOutbox(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      const now = new Date();
      const due = await this.prisma.pushOutbox.findMany({
        where: { status: "PENDING", sendAt: { lte: now } },
        orderBy: { sendAt: "asc" },
        take: 50,
      });
      for (const row of due) {
        try {
          const members = await this.resolveEntitledMembers(
            row.levelIds,
            row.broadcast,
          );
          // Durable inbox row for EVERY entitled member (incl. push opt-outs)
          // FIRST — before claiming the row SENT — so a failure here leaves the
          // row PENDING to retry rather than losing the inbox (fan-out content /
          // live have no email fallback). recordMany is idempotent
          // (createMany + skipDuplicates) so a re-drain / concurrent worker is
          // safe; it THROWS on a real DB error so we fall to the retry catch.
          if (members.length > 0) {
            await this.memberNotifications.recordMany(
              members.map((m) => m.id),
              {
                category: row.category,
                title: row.title ?? (await this.brandTitle()),
                body: row.body,
                href: row.href,
                dedupePrefix: row.dedupePrefix,
              },
            );
          }
          // Claim SENT only AFTER the inbox is durable. Atomic gate: only the
          // worker that flips PENDING->SENT sends OS push, so concurrent workers
          // (which may each have written the idempotent inbox) never double-push.
          const claim = await this.prisma.pushOutbox.updateMany({
            where: { id: row.id, status: "PENDING" },
            data: {
              status: "SENT",
              sentAt: new Date(),
              attempts: { increment: 1 },
            },
          });
          if (claim.count !== 1) continue; // another worker already sent it
          // OS push only to the consenting subset.
          const pushIds = members.filter((m) => !m.pushOptOut).map((m) => m.id);
          if (pushIds.length === 0) continue;
          // Per-recipient idempotency ledger — a re-drain skips already-logged
          // members. skipDuplicates makes the whole batch a no-op on replay.
          await this.prisma.pushLog.createMany({
            data: pushIds.map((userId) => ({
              userId,
              category: row.category,
              dedupeKey: `${row.dedupePrefix}:${userId}`,
            })),
            skipDuplicates: true,
          });
          await this.deliverToUsers(pushIds, {
            category: row.category as PushCategory,
            body: row.body,
            href: row.href,
            title: row.title ?? undefined,
          });
        } catch (err) {
          // A failure here is almost always the pre-claim inbox write (a
          // post-claim push failure no-ops the PENDING guard below, since the
          // row is already SENT). Leave the row PENDING to retry next tick — all
          // its writes are idempotent — capping attempts so a permanently-bad
          // row eventually stops as FAILED.
          const error = String(err instanceof Error ? err.message : err).slice(
            0,
            500,
          );
          const attempts = row.attempts + 1;
          await this.prisma.pushOutbox.updateMany({
            where: { id: row.id, status: "PENDING" },
            data:
              attempts >= MAX_OUTBOX_ATTEMPTS
                ? { status: "FAILED", attempts, error }
                : { attempts, error },
          });
        }
      }
    } catch (err) {
      this.logger.warn(
        `[push] outbox drain failed: ${err instanceof Error ? err.message : err}`,
      );
    } finally {
      this.draining = false;
    }
  }

  // ---------- Delivery (shared by 1:1 dispatch and fan-out drain) ----------

  // Load every non-disabled token for the cohort, build one chunked Expo send,
  // and prune tokens Expo rejects. Body is anti-steering-stripped for billing
  // categories; the title defaults to the per-academy brand (resolved once).
  private async deliverToUsers(
    userIds: string[],
    payload: DeliverPayload,
  ): Promise<void> {
    if (userIds.length === 0) return;
    const tokens = await this.prisma.deviceToken.findMany({
      where: { userId: { in: userIds }, disabled: false },
      select: { expoPushToken: true },
    });
    if (tokens.length === 0) return;

    const title = (payload.title ?? (await this.brandTitle())).trim();
    const body = BILLING_CATEGORIES.has(payload.category)
      ? stripSteering(payload.body)
      : payload.body;

    const messages: ExpoPushMessage[] = tokens
      .filter((t) => Expo.isExpoPushToken(t.expoPushToken))
      .map((t) => ({
        to: t.expoPushToken,
        title,
        body,
        data: { href: payload.href, category: payload.category },
        sound: "default",
        priority: "high",
      }));
    if (messages.length === 0) return;

    for (const chunk of this.expo.chunkPushNotifications(messages)) {
      try {
        const tickets = await this.expo.sendPushNotificationsAsync(chunk);
        await this.pruneInvalidTokens(chunk, tickets);
        await this.recordReceipts(chunk, tickets);
      } catch (err) {
        this.logger.warn(
          `[push] send chunk failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  // Persist each accepted ("ok") ticket so its delivery RECEIPT can be polled
  // later — that is where DeviceNotRegistered usually surfaces (the immediate
  // ticket rarely carries it). Errored tickets are handled synchronously by
  // pruneInvalidTokens and carry no id.
  private async recordReceipts(
    chunk: ExpoPushMessage[],
    tickets: ExpoPushTicket[],
  ): Promise<void> {
    const checkAfter = new Date(Date.now() + RECEIPT_CHECK_DELAY_MS);
    const rows: {
      receiptId: string;
      expoPushToken: string;
      checkAfter: Date;
    }[] = [];
    tickets.forEach((ticket, i) => {
      if (ticket.status === "ok" && ticket.id) {
        const to = chunk[i]?.to;
        const token = Array.isArray(to) ? to[0] : to;
        if (typeof token === "string") {
          rows.push({ receiptId: ticket.id, expoPushToken: token, checkAfter });
        }
      }
    });
    if (rows.length > 0) {
      await this.prisma.pushReceipt.createMany({
        data: rows,
        skipDuplicates: true,
      });
    }
  }

  // Poll due delivery receipts once a minute and disable tokens Expo reports as
  // DeviceNotRegistered (the deferred half of token hygiene; the immediate half
  // is pruneInvalidTokens). A receipt id ABSENT from Expo's response = "not
  // ready" → left PENDING and retried; genuinely stuck rows are reaped by age.
  private receiptDraining = false;

  @Cron(CronExpression.EVERY_MINUTE)
  async drainPushReceipts(): Promise<void> {
    if (this.receiptDraining) return;
    this.receiptDraining = true;
    try {
      const now = new Date();
      const due = await this.prisma.pushReceipt.findMany({
        where: { status: "PENDING", checkAfter: { lte: now } },
        take: 1000,
      });
      if (due.length > 0) {
        const byId = new Map(due.map((r) => [r.receiptId, r]));
        const resolved: string[] = [];
        const toDisable = new Set<string>();
        // Delivery receipts that errored for any reason OTHER than
        // DeviceNotRegistered — a bad APNs/FCM credential, MessageTooBig,
        // MessageRateExceeded — are where an iOS/Android push MISCONFIG actually
        // surfaces (the immediate ticket is usually "ok"). They used to be marked
        // DONE silently; aggregate + WARN so the cause is visible in the logs.
        const receiptErrors = new Map<string, number>();
        for (const idChunk of this.expo.chunkPushNotificationReceiptIds(
          due.map((r) => r.receiptId),
        )) {
          let receipts;
          try {
            receipts =
              await this.expo.getPushNotificationReceiptsAsync(idChunk);
          } catch (err) {
            this.logger.warn(
              `[push] receipt fetch failed: ${err instanceof Error ? err.message : err}`,
            );
            continue; // leave these PENDING — retry next tick
          }
          for (const [receiptId, receipt] of Object.entries(receipts)) {
            resolved.push(receiptId); // present in the response => resolved
            if (receipt.status !== "error") continue;
            if (receipt.details?.error === "DeviceNotRegistered") {
              const row = byId.get(receiptId);
              if (row) toDisable.add(row.expoPushToken);
              continue;
            }
            const key = receipt.details?.error ?? receipt.message ?? "unknown";
            receiptErrors.set(key, (receiptErrors.get(key) ?? 0) + 1);
          }
        }
        if (receiptErrors.size > 0) {
          const summary = [...receiptErrors.entries()]
            .map(([code, n]) => `${code}×${n}`)
            .join(", ");
          this.logger.warn(`[push] Expo delivery receipts errored: ${summary}`);
        }
        if (toDisable.size > 0) {
          await this.prisma.deviceToken.updateMany({
            where: { expoPushToken: { in: [...toDisable] } },
            data: { disabled: true },
          });
        }
        if (resolved.length > 0) {
          await this.prisma.pushReceipt.updateMany({
            where: { receiptId: { in: resolved } },
            data: { status: "DONE" },
          });
        }
      }
      // Reap receipts Expo never returned (would otherwise stay PENDING forever
      // and grow the due-query). Age-based only — a missing id is "not ready".
      await this.prisma.pushReceipt.updateMany({
        where: {
          status: "PENDING",
          createdAt: { lt: new Date(now.getTime() - RECEIPT_GIVE_UP_MS) },
        },
        data: { status: "DONE" },
      });
    } catch (err) {
      this.logger.warn(
        `[push] receipt drain failed: ${err instanceof Error ? err.message : err}`,
      );
    } finally {
      this.receiptDraining = false;
    }
  }

  // Disable tokens Expo reports as no longer registered, so fan-out stays honest.
  // Every OTHER ticket error (a bad APNs/FCM credential, an invalid payload, a
  // rate limit) used to be dropped silently here — the reason a misconfigured
  // push key showed "nothing delivered" with zero server signal. Aggregate and
  // WARN those so the failure is diagnosable from the logs.
  private async pruneInvalidTokens(
    chunk: ExpoPushMessage[],
    tickets: ExpoPushTicket[],
  ): Promise<void> {
    const toDisable: string[] = [];
    const otherErrors = new Map<string, number>();
    tickets.forEach((ticket, i) => {
      if (ticket.status !== "error") return;
      if (ticket.details?.error === "DeviceNotRegistered") {
        const to = chunk[i]?.to;
        const token = Array.isArray(to) ? to[0] : to;
        if (typeof token === "string") toDisable.push(token);
        return;
      }
      const key = ticket.details?.error ?? ticket.message ?? "unknown";
      otherErrors.set(key, (otherErrors.get(key) ?? 0) + 1);
    });
    if (otherErrors.size > 0) {
      const summary = [...otherErrors.entries()]
        .map(([code, n]) => `${code}×${n}`)
        .join(", ");
      this.logger.warn(`[push] Expo rejected send tickets: ${summary}`);
    }
    if (toDisable.length > 0) {
      await this.prisma.deviceToken.updateMany({
        where: { expoPushToken: { in: toDisable } },
        data: { disabled: true },
      });
    }
  }

  // Per-academy brand for the notification title. Read straight from the
  // AppConfig singleton (push isn't in SiteModule) with the same fallback the
  // billing/helpdesk email paths use. Never uses the client-only pickBrandTitle.
  private async brandTitle(): Promise<string> {
    try {
      const row = await this.prisma.appConfig.findUnique({
        where: { id: "singleton" },
      });
      const title = (row?.config as { title?: unknown } | null)?.title;
      return typeof title === "string" && title.trim()
        ? title
        : "Spotlight Academy";
    } catch {
      return "Spotlight Academy";
    }
  }
}
