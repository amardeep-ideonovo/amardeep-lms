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
      <h1>Welcome back</h1>
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
        <button
          type="submit"
          className="btn btn-primary btn-block"
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
