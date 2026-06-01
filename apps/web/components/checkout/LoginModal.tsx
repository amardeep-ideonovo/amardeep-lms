"use client";

import { FormEvent, useEffect, useState } from "react";
import type { AuthUser } from "@lms/types";
import { ApiError, login } from "@/lib/checkout-service";

// "Already a member?" popup. On success it hands the logged-in user back to the
// checkout page, which switches to the logged-in (State B) experience.
export default function LoginModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: (user: AuthUser) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await login(email.trim(), password);
      onSuccess(user);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not sign in. Try again.",
      );
      setBusy(false);
    }
  }

  return (
    <div
      className="co-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Log in"
      onClick={onClose}
    >
      <div className="co-modal" onClick={(e) => e.stopPropagation()}>
        <div className="co-modal-head">
          <h2>Log in</h2>
          <button
            type="button"
            className="co-modal-x"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <form className="co-modal-body" onSubmit={submit}>
          {error && <div className="co-alert co-alert-error">{error}</div>}
          <input
            className="co-input"
            type="email"
            placeholder="Email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            required
          />
          <input
            className="co-input"
            type="password"
            placeholder="Password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button
            type="submit"
            className="co-btn co-btn--navy co-btn--block"
            disabled={busy || !email || !password}
          >
            {busy ? "Signing in…" : "Log in"}
          </button>
        </form>
      </div>
    </div>
  );
}
