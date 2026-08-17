import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { randomBytes } from "crypto";
import * as bcrypt from "bcryptjs";
import type { User } from "@prisma/client";
import type { ErrorCode } from "@lms/types";
import { PrismaService } from "../prisma/prisma.service";
import type { JwtPayload } from "../auth/jwt-payload.interface";
import {
  makePreviewHandoffToken,
  verifyPreviewHandoffToken,
} from "./site-preview-token.util";

export type PreviewMode = "locked" | "unlocked";

// Preview session tokens live ONE HOUR — long enough for a real look-around,
// short enough to bound a leaked session. Deliberately NOT the global 7d
// JWT_TTL. Revocable early via endPreview() (bumps tokenVersion).
const PREVIEW_SESSION_TTL = "1h";

// Backs the "admin previews the member site without an account" feature. Owns
// the two hidden synthetic "preview member" User rows (one per mode), the
// handoff→session exchange, and the kill switch. Depends only on Prisma + Jwt,
// so AccessService can inject it (via the @Global module) with no cycle.
@Injectable()
export class SitePreviewService {
  private readonly logger = new Logger(SitePreviewService.name);

  // Memoized id of the UNLOCKED preview user — the only one AccessService cares
  // about. null = not yet resolved; "" = resolved, none exists yet (avoids
  // re-querying on every member request). Overwritten the moment we create it.
  private unlockedUserId: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  // Lazily get-or-create the single preview user for a mode. Identity is random
  // and unroutable (.invalid TLD, RFC 2606) so it can never receive mail; the
  // password is random and never used (sessions are minted, never logged into).
  async ensurePreviewUser(mode: PreviewMode): Promise<User> {
    const existing = await this.prisma.user.findFirst({
      where: { isPreview: true, previewMode: mode },
    });
    if (existing) {
      if (mode === "unlocked") this.unlockedUserId = existing.id;
      return existing;
    }
    const rand = randomBytes(12).toString("hex");
    try {
      const created = await this.prisma.user.create({
        data: {
          email: `preview-${mode}+${rand}@preview.invalid`,
          username: `preview_${mode}_${rand}`,
          passwordHash: await bcrypt.hash(randomBytes(32).toString("hex"), 10),
          firstName: "Preview",
          lastName: mode === "unlocked" ? "Member" : "Visitor",
          isPreview: true,
          previewMode: mode,
        },
      });
      if (mode === "unlocked") this.unlockedUserId = created.id;
      return created;
    } catch {
      // P2002 race (a concurrent first-start created it) — re-select.
      const again = await this.prisma.user.findFirst({
        where: { isPreview: true, previewMode: mode },
      });
      if (again) {
        if (mode === "unlocked") this.unlockedUserId = again.id;
        return again;
      }
      throw new BadRequestException(
        "Could not initialise the preview session.",
      );
    }
  }

  // Hot-path predicate for the entitlement bypass (AccessService.activeLevelIds).
  // Matches ONLY the unlocked identity; the locked one flows through the normal
  // "owns nothing" path. One memoized lookup, then an in-memory string compare.
  async isUnlockedPreviewUser(userId: string): Promise<boolean> {
    if (this.unlockedUserId === null) {
      const row = await this.prisma.user.findFirst({
        where: { isPreview: true, previewMode: "unlocked" },
        select: { id: true },
      });
      this.unlockedUserId = row?.id ?? ""; // "" = resolved, none yet
    }
    return this.unlockedUserId !== "" && userId === this.unlockedUserId;
  }

  // Admin action: ensure both identities exist, return a 60s handoff token.
  async startPreview(): Promise<{ handoff: string }> {
    await this.ensurePreviewUser("unlocked");
    await this.ensurePreviewUser("locked");
    return { handoff: makePreviewHandoffToken() };
  }

  // Public exchange: validate the handoff, then mint a read-only member session
  // JWT for EACH identity so the web can toggle between locked/unlocked without
  // a second admin round-trip. The long-lived tokens are returned in the POST
  // body (over TLS), never in a URL.
  async exchange(
    handoff: string,
  ): Promise<{ unlockedToken: string; lockedToken: string }> {
    if (!verifyPreviewHandoffToken(handoff)) {
      throw new BadRequestException({
        code: "PREVIEW_LINK_INVALID" satisfies ErrorCode,
        message: "This preview link is invalid or has expired.",
      });
    }
    const [unlocked, locked] = await Promise.all([
      this.ensurePreviewUser("unlocked"),
      this.ensurePreviewUser("locked"),
    ]);
    const [unlockedToken, lockedToken] = await Promise.all([
      this.signPreviewSession(unlocked),
      this.signPreviewSession(locked),
    ]);
    return { unlockedToken, lockedToken };
  }

  private signPreviewSession(user: User): Promise<string> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      username: user.username,
      isAdmin: false,
      isPreview: true,
      tv: user.tokenVersion,
    };
    return this.jwt.signAsync(payload, { expiresIn: PREVIEW_SESSION_TTL });
  }

  // Kill switch: bump both preview users' tokenVersion so every live preview
  // session is rejected by JwtStrategy's tv check on its next request.
  async endPreview(): Promise<{ ok: true }> {
    try {
      await this.prisma.user.updateMany({
        where: { isPreview: true },
        data: { tokenVersion: { increment: 1 } },
      });
    } catch (e) {
      this.logger.warn(
        `[site-preview] endPreview failed: ${
          e instanceof Error ? e.message : e
        }`,
      );
    }
    return { ok: true };
  }
}
