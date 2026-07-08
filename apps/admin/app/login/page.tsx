"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, api, setToken } from "@/lib/api";
import { useAppBrand } from "@/lib/app-brand";

export default function LoginPage() {
  const router = useRouter();
  // Per-instance brand (AppConfig title); neutral "Admin" until set.
  const brand = useAppBrand();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Surface a prompt when the API invalidated the session (request() redirects
  // here with ?session=expired on a 401, e.g. a token whose admin no longer
  // exists after a DB reseed).
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("session") === "expired"
    ) {
      setNotice("Your session is no longer valid — please sign in again.");
    }
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.adminLogin(email, password);
      setToken(res.token);
      router.replace("/");
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Login failed. Try again."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={onSubmit}>
        <div className="page-header">
          <div className="login-brand">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M5 2.2 11.6 6 7.8 12.6 1.2 8.8Z" fill="#3cc4b2" />
              <ellipse cx="14.8" cy="18.6" rx="6.8" ry="2.9" fill="rgba(60,196,178,.32)" />
            </svg>
            <h1 style={{ margin: 0 }}>{brand ?? "Admin"}</h1>
          </div>
          <p className="subtitle">Sign in to continue</p>
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            autoComplete="username"
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {notice && <p className="alert-warning">{notice}</p>}
        {error && <p className="error">{error}</p>}
        <button className="btn" type="submit" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
