"use client";

// Operator sign-in — the INTERNAL fleet console entrance. Deliberately
// separate from every client-facing surface: dark ink-on-ink panel, no links
// out. Preview stub: any credentials work (see lib/auth.ts).

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { isOperator, operatorSignIn } from "@/lib/auth";
import { LogoGlyph } from "@/components/icons";

export default function OperatorLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  // Already signed in? Straight to the console.
  useEffect(() => {
    if (isOperator()) router.replace("/operator");
  }, [router]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await operatorSignIn(email, password);
    router.push("/operator");
  };

  return (
    <main className="oplogin-page page-in">
      <div className="oplogin-card">
        <div className="oplogin-logo">
          <LogoGlyph size={26} />
          <span className="oplogin-logo-text">
            <span className="oplogin-logo-name">Spotlight LMS</span>
            <span className="oplogin-logo-sub">CONTROL PLANE</span>
          </span>
          <span className="oplogin-env">INTERNAL</span>
        </div>
        <h1 className="oplogin-title">Operator sign-in</h1>
        <p className="oplogin-sub">Internal fleet console.</p>
        <form className="login-form" onSubmit={submit}>
          <label className="field field-dark">
            <span className="field-label">Email</span>
            <input
              className="input input-dark"
              type="email"
              name="email"
              autoComplete="email"
              placeholder="you@spotlightlms.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
          </label>
          <label className="field field-dark">
            <span className="field-label">Password</span>
            <input
              className="input input-dark"
              type="password"
              name="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={busy}
            style={{ padding: "12px 16px" }}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="oplogin-foot">Preview build — any credentials work.</p>
      </div>
    </main>
  );
}
