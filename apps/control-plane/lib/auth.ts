"use client";

// UI-only auth stub for the control-plane preview — TWO fully separate
// surfaces, mirroring the real product model:
//
//   OPERATOR (internal fleet console)
//     token key "lms.ops.operator.token" — /operator/login, any credentials.
//
//   CLIENT (license holder)
//     session key "lms.ops.client.session" — JSON { clientId, email, name }.
//     Accounts are records in the persisted mock store (lib/provisioner.ts):
//     clientSignUp() creates one, clientSignIn() looks it up by email.
//     "?demo=1" seeds a session bound to the seeded Harbor Yoga client.
//
// The old combined keys ("lms.ops.token" / "lms.ops.role") are simply
// ignored — stale values are never read. A real implementation swaps these
// for POST /auth/login on the fleet API with the same storage contracts.

import { useEffect, useState } from "react";
import {
  createClientAccount,
  DEMO_CLIENT_ID,
  findClientByEmail,
  getFleetSnapshot,
} from "./provisioner";
import type { PlanTier } from "./types";

const OPERATOR_TOKEN_KEY = "lms.ops.operator.token";
const CLIENT_SESSION_KEY = "lms.ops.client.session";

/** Simulated latency to match the mock fleet API. */
const latency = () => new Promise<void>((r) => setTimeout(r, 150));

// ============================================================
// Operator (internal console)
// ============================================================

export function isOperator(): boolean {
  if (typeof window === "undefined") return false;
  return !!window.localStorage.getItem(OPERATOR_TOKEN_KEY);
}

export async function operatorSignIn(email: string, _password: string): Promise<void> {
  await latency();
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    OPERATOR_TOKEN_KEY,
    `op.${btoa(email || "operator").replace(/=+$/, "")}.${Date.now()}`
  );
}

export function operatorSignOut(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(OPERATOR_TOKEN_KEY);
}

// ============================================================
// Client (license holder)
// ============================================================

export interface ClientSession {
  clientId: string;
  email: string;
  name: string;
  /** True when the session was seeded by "?demo=1" (Harbor Yoga demo). */
  demo?: boolean;
}

export function getClientSession(): ClientSession | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(CLIENT_SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ClientSession;
    if (parsed && typeof parsed.clientId === "string" && typeof parsed.email === "string") {
      return parsed;
    }
  } catch {
    // Corrupt blob — treat as signed out.
  }
  return null;
}

function setClientSession(session: ClientSession): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CLIENT_SESSION_KEY, JSON.stringify(session));
}

export function clientSignOut(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(CLIENT_SESSION_KEY);
}

export interface ClientSignUpInput {
  name: string;
  academyName: string;
  email: string;
  /** Accepted but unused — preview build. */
  password: string;
  plan: PlanTier;
}

export type ClientAuthResult =
  | { ok: true; session: ClientSession }
  | { ok: false; error: string };

/**
 * Creates the account (client + license records in the store — the operator
 * console picks the new license up immediately) and signs the browser in.
 */
export async function clientSignUp(input: ClientSignUpInput): Promise<ClientAuthResult> {
  const result = await createClientAccount({
    name: input.name,
    academyName: input.academyName,
    email: input.email,
    plan: input.plan,
  });
  if (!result.ok) return { ok: false, error: result.error };
  const session: ClientSession = {
    clientId: result.client.id,
    email: result.client.email,
    name: result.client.name,
  };
  setClientSession(session);
  return { ok: true, session };
}

/**
 * Looks the account up by email (case-insensitive) in the persisted store.
 * Any password is accepted — preview build.
 */
export async function clientSignIn(email: string, _password: string): Promise<ClientAuthResult> {
  await latency();
  const account = findClientByEmail(email);
  if (!account) {
    return { ok: false, error: "No account for that email — create one on the sales page." };
  }
  const session: ClientSession = {
    clientId: account.id,
    email: account.email,
    name: account.name,
  };
  setClientSession(session);
  return { ok: true, session };
}

/**
 * "?demo=1" — seeds a client session bound to the seeded Harbor Yoga client
 * so "See it live" works without an account.
 */
export function startDemoSession(): ClientSession {
  const demoClient = getFleetSnapshot().clients.find((c) => c.id === DEMO_CLIENT_ID);
  const session: ClientSession = {
    clientId: DEMO_CLIENT_ID,
    email: demoClient?.email ?? "priya@harboryoga.com",
    name: demoClient?.name ?? "Priya Sharma",
    demo: true,
  };
  setClientSession(session);
  return session;
}

/**
 * Reads the client session after mount (SSR-safe — first render returns null,
 * so static export markup stays deterministic).
 */
export function useClientSession(): ClientSession | null {
  const [session, setSession] = useState<ClientSession | null>(null);
  useEffect(() => {
    setSession(getClientSession());
  }, []);
  return session;
}
