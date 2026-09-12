import { Injectable, Logger } from "@nestjs/common";
import {
  Expo,
  type ExpoPushMessage,
  type ExpoPushTicket,
} from "expo-server-sdk";
import { PrismaService } from "../prisma/prisma.service";
import type { RegisterDeviceTokenDto } from "./dto/register-device-token.dto";

// The member push categories P0 ships. Kept as a local union (the API consumes
// @lms/types as TYPES only and cannot import runtime values from it).
export type PushCategory =
  "helpdesk-reply" | "payment-failed" | "subscription-active";

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

  constructor(private readonly prisma: PrismaService) {}

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
      if (!user || user.pushOptOut) return;

      // Idempotency: the unique dedupeKey collapses concurrent webhook replays —
      // the first create wins, any duplicate throws P2002 and we bail. (Mirrors
      // the email engine's "record then send"; push is a best-effort supplement
      // to the transactional email, so record-before-send is acceptable.)
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

      const tokens = await this.prisma.deviceToken.findMany({
        where: { userId: input.userId, disabled: false },
        select: { expoPushToken: true },
      });
      if (tokens.length === 0) return;

      const title = (input.title ?? (await this.brandTitle())).trim();
      const body = BILLING_CATEGORIES.has(input.category)
        ? stripSteering(input.body)
        : input.body;

      const messages: ExpoPushMessage[] = tokens
        .filter((t) => Expo.isExpoPushToken(t.expoPushToken))
        .map((t) => ({
          to: t.expoPushToken,
          title,
          body,
          data: { href: input.href, category: input.category },
          sound: "default",
          priority: "high",
        }));
      if (messages.length === 0) return;

      for (const chunk of this.expo.chunkPushNotifications(messages)) {
        try {
          const tickets = await this.expo.sendPushNotificationsAsync(chunk);
          await this.pruneInvalidTokens(chunk, tickets);
        } catch (err) {
          this.logger.warn(
            `[push] send chunk failed: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        `[push] dispatch ${input.category} failed for ${input.userId}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  // Disable tokens Expo reports as no longer registered, so fan-out stays honest.
  private async pruneInvalidTokens(
    chunk: ExpoPushMessage[],
    tickets: ExpoPushTicket[],
  ): Promise<void> {
    const toDisable: string[] = [];
    tickets.forEach((ticket, i) => {
      if (
        ticket.status === "error" &&
        ticket.details?.error === "DeviceNotRegistered"
      ) {
        const to = chunk[i]?.to;
        const token = Array.isArray(to) ? to[0] : to;
        if (typeof token === "string") toDisable.push(token);
      }
    });
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
