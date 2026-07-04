import { setWorldConstructor, World, setDefaultTimeout } from "@cucumber/cucumber";

setDefaultTimeout(30_000);

// Black-box BDD: every step talks to the running API over HTTP, exactly like a
// real client. Credentials below come from the dev seed (packages/db/prisma/seed.ts).
const BASE_URL = (process.env.API_URL || "http://localhost:3000").replace(/\/$/, "");

export const SEED = {
  admin: { email: "admin@example.com", password: "admin123" },
  member: { email: "member@example.com", password: "member123" },
};

export type HttpResult = { status: number; body: any };

export class LmsWorld extends World {
  baseUrl = BASE_URL;
  memberToken: string | null = null;
  adminTokenValue: string | null = null;
  memberIdValue: string | null = null;
  last: HttpResult = { status: 0, body: null };
  formId: string | null = null;
  popupId: string | null = null;
  createdPostId: string | null = null; // blog post created via the admin POST step
  createdPageId: string | null = null; // CMS page created via the admin POST step
  savedAppConfig: unknown = null; // captured by the app-config round-trip for restore
  // certificates.feature state (cleaned up by the After hooks)
  certificateMediaId: string | null = null; // uploaded artwork media asset
  certificateMediaUrl: string | null = null; // its /media/<key> URL
  certificateTemplateId: string | null = null; // template created by the scenario
  certificateId: string | null = null; // claimed certificate row
  certificateSerial: string | null = null; // serial of the FIRST claim (idempotency checks)

  async request(
    method: string,
    path: string,
    opts: { token?: string | null; body?: unknown } = {},
  ): Promise<HttpResult> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    let body: any = null;
    const text = await res.text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    this.last = { status: res.status, body };
    return this.last;
  }

  async login(email: string, password: string): Promise<HttpResult> {
    return this.request("POST", "/auth/login", { body: { email, password } });
  }

  async adminToken(): Promise<string> {
    if (this.adminTokenValue) return this.adminTokenValue;
    const r = await this.request("POST", "/auth/admin/login", {
      body: { email: SEED.admin.email, password: SEED.admin.password },
    });
    if (r.status !== 200 || !r.body?.token) {
      throw new Error(`Admin login failed (status ${r.status})`);
    }
    this.adminTokenValue = r.body.token;
    return this.adminTokenValue!;
  }

  async ensureMemberLoggedIn(): Promise<void> {
    const r = await this.login(SEED.member.email, SEED.member.password);
    if (r.status !== 200 || !r.body?.token) {
      throw new Error(`Member login failed (status ${r.status})`);
    }
    this.memberToken = r.body.token;
    this.memberIdValue = r.body.user?.id ?? null;
  }

  async memberId(): Promise<string> {
    if (!this.memberIdValue) await this.ensureMemberLoggedIn();
    return this.memberIdValue!;
  }

  // Multipart upload of a tiny in-memory PNG to the media library (the JSON
  // `request` helper can't do multipart; Node 20 ships FormData/Blob natively).
  // Used by certificates.feature to give templates real local artwork.
  async uploadMedia(): Promise<{ id: string; url: string }> {
    const token = await this.adminToken();
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const fd = new FormData();
    fd.append("file", new Blob([png], { type: "image/png" }), "bdd-artwork.png");
    const res = await fetch(`${this.baseUrl}/admin/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    const body: any = await res.json();
    if (!res.ok || !body?.id) {
      throw new Error(`artwork upload failed (status ${res.status})`);
    }
    this.certificateMediaId = body.id;
    // Store the path form (/media/<key>) — what templates persist.
    this.certificateMediaUrl = new URL(body.url).pathname;
    return { id: body.id, url: this.certificateMediaUrl! };
  }
}

setWorldConstructor(LmsWorld);
