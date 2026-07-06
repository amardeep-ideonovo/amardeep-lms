// UI-only auth stub for the control-plane preview. Mirrors the admin app's
// localStorage token pattern (admin uses "lms.admin.token"); any credentials
// are accepted. A real implementation swaps login() for POST /auth/login on
// the fleet API and keeps the same storage contract.

export type OpsRole = "operator" | "client";

const TOKEN_KEY = "lms.ops.token";
const ROLE_KEY = "lms.ops.role";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function getRole(): OpsRole | null {
  if (typeof window === "undefined") return null;
  const role = window.localStorage.getItem(ROLE_KEY);
  return role === "operator" || role === "client" ? role : null;
}

export async function login(email: string, _password: string, role: OpsRole): Promise<OpsRole> {
  // Simulated latency to match the mock fleet API.
  await new Promise((r) => setTimeout(r, 150));
  if (typeof window !== "undefined") {
    window.localStorage.setItem(TOKEN_KEY, `demo.${btoa(email || "guest").replace(/=+$/, "")}.${Date.now()}`);
    window.localStorage.setItem(ROLE_KEY, role);
  }
  return role;
}

export function logout(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(ROLE_KEY);
}

export function homeFor(role: OpsRole): string {
  return role === "operator" ? "/operator" : "/portal";
}
