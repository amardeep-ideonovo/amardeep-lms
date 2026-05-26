"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  ApiError,
  api,
  type MailchimpSettingsMasked,
  type StripeSettingsMasked,
} from "@/lib/api";

export default function SettingsPage() {
  return (
    <div>
      <div className="page-header">
        <h1>Settings</h1>
        <p className="subtitle">
          Secrets are write-only. Saved values are shown masked (last 4 only).
        </p>
      </div>
      <StripeSection />
      <MailchimpSection />
    </div>
  );
}

function masked(last4: string | null) {
  return last4 ? `•••• ${last4}` : "not set";
}

function StripeSection() {
  const [current, setCurrent] = useState<StripeSettingsMasked | null>(null);
  const [removing, setRemoving] = useState(false);
  const [secretKey, setSecretKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [publishableKey, setPublishableKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setError(null);
    try {
      const s = await api.getStripeSettings();
      setCurrent(s);
      setPublishableKey(s.publishableKey ?? "");
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load Stripe settings"
      );
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      // Only send fields the admin actually entered (avoid clobbering secrets).
      const updated = await api.putStripeSettings({
        secretKey: secretKey.trim() || undefined,
        webhookSecret: webhookSecret.trim() || undefined,
        publishableKey: publishableKey.trim() || undefined,
      });
      setCurrent(updated);
      setSecretKey("");
      setWebhookSecret("");
      setStatus("Stripe settings saved.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm("Remove all Stripe keys? This cannot be undone."))
      return;
    setRemoving(true);
    setError(null);
    setStatus(null);
    try {
      const cleared = await api.clearStripeSettings();
      setCurrent(cleared);
      setSecretKey("");
      setWebhookSecret("");
      setPublishableKey("");
      setStatus("Stripe keys removed.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Remove failed");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="card">
      <h2>Stripe</h2>
      <form onSubmit={save}>
        <div className="field">
          <label>
            Secret key{" "}
            <span className="muted">
              (current: {masked(current?.secretKeyLast4 ?? null)})
            </span>
          </label>
          <input
            type="password"
            value={secretKey}
            placeholder="sk_live_…  (leave blank to keep)"
            onChange={(e) => setSecretKey(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label>
            Webhook secret{" "}
            <span className="muted">
              (current: {masked(current?.webhookSecretLast4 ?? null)})
            </span>
          </label>
          <input
            type="password"
            value={webhookSecret}
            placeholder="whsec_…  (leave blank to keep)"
            onChange={(e) => setWebhookSecret(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label>Publishable key</label>
          <input
            value={publishableKey}
            placeholder="pk_live_…"
            onChange={(e) => setPublishableKey(e.target.value)}
          />
        </div>
        {error && <p className="error">{error}</p>}
        {status && <p className="muted">{status}</p>}
        <div className="row-actions">
          <button className="btn" type="submit" disabled={saving || removing}>
            {saving ? "Saving…" : "Save Stripe settings"}
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={remove}
            disabled={removing || saving}
          >
            {removing ? "Removing…" : "Remove keys"}
          </button>
        </div>
      </form>
    </div>
  );
}

function MailchimpSection() {
  const [current, setCurrent] = useState<MailchimpSettingsMasked | null>(null);
  const [removing, setRemoving] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [serverPrefix, setServerPrefix] = useState("");
  const [audienceId, setAudienceId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setError(null);
    try {
      const s = await api.getMailchimpSettings();
      setCurrent(s);
      setServerPrefix(s.serverPrefix ?? "");
      setAudienceId(s.audienceId ?? "");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to load Mailchimp settings"
      );
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const updated = await api.putMailchimpSettings({
        apiKey: apiKey.trim() || undefined,
        serverPrefix: serverPrefix.trim() || undefined,
        audienceId: audienceId.trim() || undefined,
      });
      setCurrent(updated);
      setApiKey("");
      setStatus("Mailchimp settings saved.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (
      !window.confirm(
        "Remove the Mailchimp API key, server prefix, and audience? This cannot be undone."
      )
    )
      return;
    setRemoving(true);
    setError(null);
    setStatus(null);
    try {
      const cleared = await api.clearMailchimpSettings();
      setCurrent(cleared);
      setApiKey("");
      setServerPrefix(cleared.serverPrefix ?? "");
      setAudienceId(cleared.audienceId ?? "");
      setStatus("Mailchimp keys removed.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Remove failed");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="card">
      <h2>Mailchimp</h2>
      <form onSubmit={save}>
        <div className="field">
          <label>
            API key{" "}
            <span className="muted">
              (current: {masked(current?.apiKeyLast4 ?? null)})
            </span>
          </label>
          <input
            type="password"
            value={apiKey}
            placeholder="leave blank to keep"
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="form-row">
          <div className="field">
            <label>Server prefix</label>
            <input
              value={serverPrefix}
              placeholder="e.g. us21"
              onChange={(e) => setServerPrefix(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Audience ID</label>
            <input
              value={audienceId}
              placeholder="single audience"
              onChange={(e) => setAudienceId(e.target.value)}
            />
          </div>
        </div>
        {error && <p className="error">{error}</p>}
        {status && <p className="muted">{status}</p>}
        <div className="row-actions">
          <button className="btn" type="submit" disabled={saving || removing}>
            {saving ? "Saving…" : "Save Mailchimp settings"}
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={remove}
            disabled={removing || saving}
          >
            {removing ? "Removing…" : "Remove keys"}
          </button>
        </div>
      </form>
    </div>
  );
}
