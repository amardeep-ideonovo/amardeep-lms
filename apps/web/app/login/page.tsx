"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, setToken } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.login(email.trim(), password);
      setToken(res.token);
      router.replace("/dashboard");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to sign in. Try again."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="dark-page">
      <div className="dp-wrap">
        <div className="form-card">
      <h1>Welcome <span className="t-gradient">back</span></h1>
      <p className="sub">Sign in to access your courses.</p>

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
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <p className="sub" style={{ textAlign: "right", marginTop: -6, marginBottom: 14 }}>
          <Link href="/forgot-password" className="link">
            Forgot password?
          </Link>
        </p>
        <button
          type="submit"
          className="btn btn-primary btn-block press"
          disabled={loading}
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="sub" style={{ marginTop: 16 }}>
        New here?{" "}
        <Link href="/signup" className="link">
          Create an account
        </Link>
      </p>
        </div>
      </div>
    </div>
  );
}
