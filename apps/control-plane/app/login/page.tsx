"use client";

// Login — UI-only stub. Any credentials are accepted; role choice routes to
// the operator console or the client portal.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { getRole, getToken, homeFor, login, OpsRole } from "@/lib/auth";
import { Icon, LogoGlyph } from "@/components/icons";
import { Field } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<OpsRole>("operator");
  const [busy, setBusy] = useState(false);

  // Already signed in? Go straight to the right home.
  useEffect(() => {
    const storedRole = getRole();
    if (getToken() && storedRole) router.replace(homeFor(storedRole));
  }, [router]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await login(email, password, role);
    router.push(homeFor(r));
  };

  return (
    <main className="login-page page-in">
      <div className="login-card">
        <Link href="/" className="login-logo">
          <LogoGlyph size={26} />
          <span className="login-logo-text">
            <span className="login-logo-name">Spotlight LMS</span>
            <span className="login-logo-sub">CONTROL PLANE</span>
          </span>
        </Link>
        <h1 className="login-title">Sign in</h1>
        <p className="login-sub">Operate the fleet, or manage your own instance.</p>
        <form className="login-form" onSubmit={submit}>
          <Field label="Email">
            <input
              className="input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
          </Field>
          <Field label="Password">
            <input
              className="input"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <div className="role-pick" role="radiogroup" aria-label="Sign in as">
            <button
              type="button"
              role="radio"
              aria-checked={role === "operator"}
              className={`role-opt${role === "operator" ? " checked" : ""}`}
              onClick={() => setRole("operator")}
            >
              <span className="role-opt-title">
                <Icon name="server" size={14} />
                Operator console
              </span>
              <span className="role-opt-sub">Manage every client instance in the fleet</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={role === "client"}
              className={`role-opt${role === "client" ? " checked" : ""}`}
              onClick={() => setRole("client")}
            >
              <span className="role-opt-title">
                <Icon name="grid" size={14} />
                Client portal
              </span>
              <span className="role-opt-sub">Your license, backups, apps &amp; billing</span>
            </button>
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={busy} style={{ padding: "12px 16px" }}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="login-foot">
          Preview build — any credentials work. <Link href="/">Back to the site</Link>
        </p>
      </div>
    </main>
  );
}
