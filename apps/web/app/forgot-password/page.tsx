"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

// Self-serve password reset, step 1: ask for the account email. The API
// answers { ok: true } whether or not an account exists, so the success copy
// is deliberately conditional ("if an account exists…") — this page can never
// confirm that an email is registered.
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      // Only transport/rate-limit failures land here — never "no such account".
      setError(
        err instanceof Error ? err.message : "Something went wrong. Try again."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="dark-page">
      <div className="dp-wrap">
        <div className="form-card">
          <h1>Forgot your <span className="t-gradient">password?</span></h1>

          {sent ? (
            <>
              <p className="sub">
                If an account exists for <strong>{email.trim()}</strong>, we’ve
                emailed it a link to choose a new password. The link expires in
                45 minutes — check your spam folder if it doesn’t arrive.
              </p>
              <p className="sub" style={{ marginTop: 16 }}>
                <Link href="/login" className="link">
                  Back to sign in
                </Link>
              </p>
            </>
          ) : (
            <>
              <p className="sub">
                Enter your account email and we’ll send you a link to reset it.
              </p>

              {error && <div className="alert alert-error">{error}</div>}

              <form onSubmit={onSubmit}>
                <div className="field">
                  <label htmlFor="email">Email</label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <button
                  type="submit"
                  className="btn btn-primary btn-block press"
                  disabled={loading}
                >
                  {loading ? "Sending…" : "Send reset link"}
                </button>
              </form>

              <p className="sub" style={{ marginTop: 16 }}>
                Remembered it?{" "}
                <Link href="/login" className="link">
                  Sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
