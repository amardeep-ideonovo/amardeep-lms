import { Injectable, Logger } from "@nestjs/common";

/**
 * Best-effort, fire-and-forget signals from THIS instance up to the control
 * plane, over the same authenticated channel the support sync already uses
 * (CONTROL_PLANE_URL + the per-instance INSTANCE_SERVICE_TOKEN bearer). The
 * control plane resolves the instance from the token, so we never send an
 * instance id — and, deliberately, never a password.
 *
 * Everything here is inert unless BOTH env vars are set (they are injected by
 * the provisioner). A bare/dev run has no control plane, so signals no-op.
 */
@Injectable()
export class ControlPlaneNotifier {
  private readonly logger = new Logger(ControlPlaneNotifier.name);
  private readonly baseUrl = (process.env.CONTROL_PLANE_URL ?? "").replace(
    /\/+$/,
    "",
  );
  private readonly token = process.env.INSTANCE_SERVICE_TOKEN ?? "";

  private get enabled(): boolean {
    return !!(this.baseUrl && this.token);
  }

  /**
   * Tell the control plane that an admin set their OWN password, so its operator
   * console and client portal stop showing the (now stale) provisioning
   * password we handed out at setup. We send the admin's EMAIL only — never the
   * new password. The control plane matches the email against the instance's
   * displayed owner-admin and ignores a change made by any secondary admin.
   *
   * Fire-and-forget: callers must NOT await this on the request path. It never
   * throws and never blocks the password change; a signal that fails to deliver
   * only leaves a dashboard briefly stale, and the next change re-sends it.
   */
  async adminCredentialsChanged(adminEmail: string): Promise<void> {
    if (!this.enabled || !adminEmail) return;
    try {
      const res = await fetch(
        `${this.baseUrl}/api/instance/admin-credentials`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.token}`,
          },
          body: JSON.stringify({
            kind: "admin.credentials_changed",
            adminEmail,
            changedAt: new Date().toISOString(),
          }),
          signal: AbortSignal.timeout(4000),
        },
      );
      if (!res.ok) {
        this.logger.warn(
          `admin-credentials signal: control plane returned ${res.status}`,
        );
      }
    } catch (e) {
      this.logger.warn(
        `admin-credentials signal failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }
}
