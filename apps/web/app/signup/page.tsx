"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PASSWORD_MIN, STR } from "@lms/types";
import { Button } from "@lms/ui";
import { api, ApiError } from "@/lib/api";
import SpotlightLogo from "@/components/SpotlightLogo";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // Match-check lives client-side, same as the reset-password / account forms.
    if (password !== confirmPassword) {
      setError(STR.errors.passwordsDontMatch);
      return;
    }
    setLoading(true);
    try {
      await api.signup({
        email: email.trim(),
        password,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim() || undefined,
        inviteCode: inviteCode.trim() || undefined,
      });
      // The API set the session cookie; drop straight into the app.
      router.replace("/dashboard");
    } catch (err) {
      // 409 → friendly message; 400 → surface the validator's first message;
      // 403 → invite code wrong; anything else → generic.
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setError(
            "An account with this email already exists. Try signing in instead.",
          );
        } else if (err.status === 403) {
          setError("That invite code isn't valid.");
        } else {
          setError(err.message);
        }
      } else {
        setError(
          err instanceof Error
            ? err.message
            : "Unable to create your account. Try again.",
        );
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="dark-page ik-auth">
      {/* Ink band + overlapping white form card (nav renders on this page,
          but the band keeps the auth pair visually consistent with /login). */}
      <div className="ik-auth-band" aria-hidden="true">
        <SpotlightLogo size={26} />
      </div>
      <div className="dp-wrap">
        <div className="form-card">
          <h1>Create your account</h1>
          <p className="sub">
            Already a member?{" "}
            <Link href="/login" className="link">
              Sign in
            </Link>
          </p>

          {error && <div className="alert alert-error">{error}</div>}

          <form onSubmit={onSubmit}>
            <div className="field-row">
              <div className="field">
                <label htmlFor="firstName">{STR.labels.firstName}</label>
                <input
                  id="firstName"
                  autoComplete="given-name"
                  required
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="lastName">{STR.labels.lastName}</label>
                <input
                  id="lastName"
                  autoComplete="family-name"
                  required
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="email">{STR.labels.email}</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="password">{STR.labels.password}</label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                minLength={PASSWORD_MIN.member}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <span className="hint">{`At least ${PASSWORD_MIN.member} characters.`}</span>
            </div>

            <div className="field">
              <label htmlFor="confirmPassword">
                {STR.labels.confirmPassword}
              </label>
              <input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                minLength={PASSWORD_MIN.member}
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="phone">Phone (optional)</label>
              <input
                id="phone"
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="inviteCode">Invite code (if you have one)</label>
              <input
                id="inviteCode"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
              />
            </div>

            <Button
              type="submit"
              block
              className="press"
              disabled={loading}
              aria-busy={loading}
            >
              {loading ? "Creating account…" : "Create account"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
