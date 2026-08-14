import { Injectable, Logger } from "@nestjs/common";
import type { AppWhiteLabelStatus } from "@lms/types";

// How long a successful answer stays fresh. The mode flips rarely (an operator
// fulfilling a paid add-on), so a short TTL is purely about not hammering the
// control plane from admin page loads.
const FRESH_MS = 5 * 60_000;
// After a FAILED fetch, don't retry for this long — otherwise a down control
// plane would add a full fetch timeout to every admin page load.
const RETRY_COOLDOWN_MS = 30_000;

/**
 * Pulls this instance's white-label status from the licensing control plane
 * over the same authenticated channel the support sync uses (CONTROL_PLANE_URL
 * + the per-instance INSTANCE_SERVICE_TOKEN bearer; tenancy is derived from
 * the token, so we never send an instance id).
 *
 * FAILS OPEN by design: with no control plane configured (bare/dev run), an
 * unreachable one, or a plane that predates the endpoint (404), this returns
 * appMode null = UNKNOWN, and the admin UI shows the icon/splash card with a
 * clarifying note instead of locking it. A blip must never lock a paying
 * white-label client out of their own branding.
 */
@Injectable()
export class WhiteLabelStatusService {
  private readonly logger = new Logger(WhiteLabelStatusService.name);
  private readonly baseUrl = (process.env.CONTROL_PLANE_URL ?? "").replace(
    /\/+$/,
    "",
  );
  private readonly token = process.env.INSTANCE_SERVICE_TOKEN ?? "";

  private cached: AppWhiteLabelStatus | null = null;
  private freshUntil = 0;
  private inflight: Promise<AppWhiteLabelStatus> | null = null;

  private get enabled(): boolean {
    return !!(this.baseUrl && this.token);
  }

  async status(): Promise<AppWhiteLabelStatus> {
    if (!this.enabled) return { appMode: null, whiteLabelRequestedAt: null };
    if (this.cached && Date.now() < this.freshUntil) return this.cached;
    // Single-flight: concurrent admin loads share one control-plane round-trip.
    if (!this.inflight) {
      this.inflight = this.refresh().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  private async refresh(): Promise<AppWhiteLabelStatus> {
    try {
      const res = await fetch(`${this.baseUrl}/api/instance/white-label`, {
        headers: { authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) throw new Error(`control plane returned ${res.status}`);
      const body = (await res.json()) as {
        appMode?: unknown;
        whiteLabelRequestedAt?: unknown;
      };
      // Re-validate the wire shape; an unknown mode string degrades to UNKNOWN
      // (fail open), never to a guess.
      const appMode =
        body.appMode === "WHITE_LABEL" || body.appMode === "SHARED"
          ? body.appMode
          : null;
      this.cached = {
        appMode,
        whiteLabelRequestedAt:
          typeof body.whiteLabelRequestedAt === "string"
            ? body.whiteLabelRequestedAt
            : null,
      };
      this.freshUntil = Date.now() + FRESH_MS;
      return this.cached;
    } catch (e) {
      this.logger.warn(
        `white-label status fetch failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      this.freshUntil = Date.now() + RETRY_COOLDOWN_MS;
      // Serve the last-known answer through a blip; UNKNOWN only when we have
      // never heard from the control plane at all.
      if (this.cached) return this.cached;
      this.cached = { appMode: null, whiteLabelRequestedAt: null };
      return this.cached;
    }
  }
}
