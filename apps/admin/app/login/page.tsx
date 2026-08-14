"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, api, setToken } from "@/lib/api";
import { useAppBrand } from "@/lib/app-brand";
import { STR } from "@lms/types";

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
        err instanceof ApiError ? err.message : "Login failed. Try again.",
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
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M12 1.7C12.93 7.35 16.65 11.07 22.3 12C16.65 12.93 12.93 16.65 12 22.3C11.07 16.65 7.35 12.93 1.7 12C7.35 11.07 11.07 7.35 12 1.7Z"
                fill="#34c9a2"
              />
            </svg>
            <h1 style={{ margin: 0 }}>{brand ?? "Admin"}</h1>
          </div>
          <p className="subtitle">Sign in to continue</p>
        </div>
        <div className="field">
          <label htmlFor="email">{STR.labels.email}</label>
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
          <label htmlFor="password">{STR.labels.password}</label>
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
