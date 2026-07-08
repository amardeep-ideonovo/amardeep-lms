"use client";

// Client sign-in — license holders only. Accounts are created on the sales
// journey (/signup); the operator console has its own separate entrance at
// /operator/login and is never mentioned here.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { clientSignIn, getClientSession } from "@/lib/auth";
import { LogoGlyph } from "@/components/icons";
import { Field } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already signed in? Go straight to the portal.
  useEffect(() => {
    if (getClientSession()) router.replace("/portal");
  }, [router]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await clientSignIn(email, password);
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }
    router.push("/portal");
  };

  return (
    <main className="login-page page-in">
      <div className="login-card">
        <Link href="/" className="login-logo">
          <LogoGlyph size={26} />
          <span className="login-logo-text">
            <span className="login-logo-name">Spotlight LMS</span>
            <span className="login-logo-sub">CLIENT PORTAL</span>
          </span>
        </Link>
        <h1 className="login-title">Sign in to your academy</h1>
        <p className="login-sub">Your license, instance, backups, apps &amp; billing.</p>
        <form method="post" className="login-form" onSubmit={submit}>
          <Field label="Email">
            <input
              className="input"
              type="email"
              name="email"
              autoComplete="email"
              placeholder="you@youracademy.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              aria-invalid={error ? true : undefined}
              autoFocus
            />
          </Field>
          <Field label="Password">
            <input
              className="input"
              type="password"
              name="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={busy}
            style={{ padding: "12px 16px" }}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <div className="login-links">
          <Link href="/signup" className="login-link-main">
            New here? Start your academy →
          </Link>
          <Link href="/portal?demo=1" className="login-link-sub">
            Just looking? View the demo portal
          </Link>
        </div>
        <p className="login-foot">
          Preview build — any password works. <Link href="/">Back to the site</Link>
        </p>
      </div>
    </main>
  );
}
