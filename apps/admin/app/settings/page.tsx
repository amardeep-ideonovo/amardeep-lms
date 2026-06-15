"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  ApiError,
  api,
  type EmailSettingsMasked,
  type MailchimpSettingsMasked,
  type PayPalSettingsMasked,
  type StripeSettingsMasked,
} from "@/lib/api";
import { useAdminAuth } from "@/components/AdminAuthProvider";
import { dialog } from "@/components/DialogProvider";

export default function SettingsPage() {
  const { can, loading } = useAdminAuth();
  if (loading) return <p className="muted">Loading…</p>;
  if (!can("settings", "read")) {
    return (
      <div>
        <div className="page-header">
          <h1>Settings</h1>
        </div>
        <p className="error">You don’t have access to settings.</p>
      </div>
    );
  }
  return (
    <div>
      <div className="page-header">
        <h1>Settings</h1>
        <p className="subtitle">
          Secrets are write-only. Saved values are shown masked (last 4 only).
        </p>
      </div>
      <PaymentProviderSection />
      <StripeSection />
      <PayPalSection />
      <EmailSenderSection />
      <MailchimpSection />
    </div>
  );
}

// Which processor NEW checkouts use. Existing subscriptions are untouched —
// they keep billing on the provider that created them, and both webhooks stay
// active, so switching is safe at any time.
function PaymentProviderSection() {
  const [provider, setProvider] = useState<"stripe" | "paypal" | null>(null);
  const [selected, setSelected] = useState<"stripe" | "paypal">("stripe");
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.getPaymentProvider();
        setProvider(r.provider);
        setSelected(r.provider);
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.message
            : "Failed to load the payment provider"
        );
      }
    })();
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setStatus(null);
    setWarning(null);
    try {
      const r = await api.putPaymentProvider(selected);
      setProvider(r.provider);
      setWarning(r.warning ?? null);
      setStatus(
        r.provider === "paypal"
          ? "New checkouts now use PayPal."
          : "New checkouts now use Stripe."
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed");
      // Snap the radio back to reality on a rejected switch.
      if (provider) setSelected(provider);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h2>Payment provider</h2>
      <p className="muted">
        Members see exactly one payment option at checkout. Applies to new
        checkouts only — existing subscriptions keep billing on the provider
        they started with, and both webhooks stay active.
      </p>
      <form onSubmit={save}>
        <div className="field" style={{ display: "grid", gap: 6 }}>
          {(
            [
              { value: "stripe", label: "Stripe (cards)" },
              { value: "paypal", label: "PayPal" },
            ] as const
          ).map((o) => (
            <label
              key={o.value}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                cursor: "pointer",
              }}
            >
              <input
                type="radio"
                name="paymentProvider"
                checked={selected === o.value}
                onChange={() => setSelected(o.value)}
              />
              <span>{o.label}</span>
              {provider === o.value && (
                <span className="badge badge--ok">Active</span>
              )}
            </label>
          ))}
        </div>
        {error && <p className="error">{error}</p>}
        {warning && <p className="error">{warning}</p>}
        {status && <p className="muted">{status}</p>}
        <div className="row-actions">
          <button
            className="btn"
            type="submit"
            disabled={saving || provider === null || selected === provider}
          >
            {saving ? "Saving…" : "Set active provider"}
          </button>
        </div>
      </form>
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
    if (
      !(await dialog.confirm({
        message: "Remove all Stripe keys? This cannot be undone.",
        danger: true,
      }))
    )
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

function PayPalSection() {
  const [current, setCurrent] = useState<PayPalSettingsMasked | null>(null);
  const [removing, setRemoving] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [webhookId, setWebhookId] = useState("");
  const [mode, setMode] = useState<"sandbox" | "live">("sandbox");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setError(null);
    try {
      const s = await api.getPayPalSettings();
      setCurrent(s);
      setClientId(s.clientId ?? "");
      setWebhookId(s.webhookId ?? "");
      setMode(s.mode ?? "sandbox");
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load PayPal settings"
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
      const updated = await api.putPayPalSettings({
        clientId: clientId.trim() || undefined,
        clientSecret: clientSecret.trim() || undefined,
        webhookId: webhookId.trim() || undefined,
        mode,
      });
      setCurrent(updated);
      setClientSecret("");
      setStatus("PayPal settings saved.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (
      !(await dialog.confirm({
        message: "Remove all PayPal credentials? This cannot be undone.",
        danger: true,
      }))
    )
      return;
    setRemoving(true);
    setError(null);
    setStatus(null);
    try {
      const cleared = await api.clearPayPalSettings();
      setCurrent(cleared);
      setClientId("");
      setClientSecret("");
      setWebhookId("");
      setMode("sandbox");
      setStatus("PayPal credentials removed.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Remove failed");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="card">
      <h2>PayPal</h2>
      <form onSubmit={save}>
        <div className="field">
          <label>Client ID</label>
          <input
            value={clientId}
            placeholder="from developer.paypal.com → Apps & Credentials"
            onChange={(e) => setClientId(e.target.value)}
          />
        </div>
        <div className="field">
          <label>
            Client secret{" "}
            <span className="muted">
              (current: {masked(current?.clientSecretLast4 ?? null)})
            </span>
          </label>
          <input
            type="password"
            value={clientSecret}
            placeholder="leave blank to keep"
            onChange={(e) => setClientSecret(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="form-row">
          <div className="field">
            <label>Webhook ID</label>
            <input
              value={webhookId}
              placeholder="WH-…  (from the app's webhook registration)"
              onChange={(e) => setWebhookId(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Mode</label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as "sandbox" | "live")}
            >
              <option value="sandbox">Sandbox (testing)</option>
              <option value="live">Live</option>
            </select>
          </div>
        </div>
        <p className="muted">
          Changing the client ID or mode clears the provisioned PayPal plans —
          they re-create automatically at the next checkout. Without a webhook
          ID, purchases still work but changes made at PayPal won’t sync
          automatically.
        </p>
        {error && <p className="error">{error}</p>}
        {status && <p className="muted">{status}</p>}
        <div className="row-actions">
          <button className="btn" type="submit" disabled={saving || removing}>
            {saving ? "Saving…" : "Save PayPal settings"}
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={remove}
            disabled={removing || saving}
          >
            {removing ? "Removing…" : "Remove credentials"}
          </button>
        </div>
      </form>
    </div>
  );
}

// Outbound email / SMTP sender (in-house Mailchimp replacement). Host/port/from
// are plain config; the SMTP password is write-only (blank keeps the stored
// value, and the form only ever shows whether one is set).
function EmailSenderSection() {
  const [current, setCurrent] = useState<EmailSettingsMasked | null>(null);
  const [removing, setRemoving] = useState(false);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [secure, setSecure] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Mirror the loaded (non-secret) config into the editable fields.
  function hydrate(s: EmailSettingsMasked) {
    setCurrent(s);
    setHost(s.host ?? "");
    setPort(s.port ?? "");
    setUser(s.user ?? "");
    setFromEmail(s.fromEmail ?? "");
    setFromName(s.fromName ?? "");
    setSecure(s.secure);
  }

  async function load() {
    setError(null);
    try {
      hydrate(await api.getEmailSettings());
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load email settings"
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
      const updated = await api.putEmailSettings({
        host: host.trim() || undefined,
        port: port.trim() || undefined,
        user: user.trim() || undefined,
        // Only send the password when the admin typed one (blank keeps stored).
        pass: pass.trim() || undefined,
        fromEmail: fromEmail.trim() || undefined,
        fromName: fromName.trim() || undefined,
        secure,
      });
      hydrate(updated);
      setPass("");
      setStatus("Email settings saved.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (
      !(await dialog.confirm({
        message:
          "Remove the SMTP host, credentials, and From address? This cannot be undone.",
        danger: true,
      }))
    )
      return;
    setRemoving(true);
    setError(null);
    setStatus(null);
    try {
      const cleared = await api.deleteEmailSettings();
      hydrate(cleared);
      setPass("");
      setStatus("Email settings removed.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Remove failed");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="card">
      <h2>Email sender (SMTP)</h2>
      <p className="muted">
        Transactional email is sent through this SMTP server. Until it’s
        configured, messages (like the signup welcome) are logged but not
        delivered.
      </p>
      <form onSubmit={save}>
        <div className="form-row">
          <div className="field">
            <label>SMTP host</label>
            <input
              value={host}
              placeholder="e.g. smtp.postmarkapp.com"
              onChange={(e) => setHost(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Port</label>
            <input
              value={port}
              placeholder="587"
              inputMode="numeric"
              onChange={(e) => setPort(e.target.value)}
            />
          </div>
        </div>
        <div className="form-row">
          <div className="field">
            <label>Username</label>
            <input
              value={user}
              placeholder="SMTP username"
              onChange={(e) => setUser(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label>
              Password{" "}
              <span className="muted">
                ({current?.passSet ? "saved" : "not set"})
              </span>
            </label>
            <input
              type="password"
              value={pass}
              placeholder="leave blank to keep"
              onChange={(e) => setPass(e.target.value)}
              autoComplete="off"
            />
          </div>
        </div>
        <div className="form-row">
          <div className="field">
            <label>From email</label>
            <input
              value={fromEmail}
              placeholder="hello@yourdomain.com"
              onChange={(e) => setFromEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label>From name</label>
            <input
              value={fromName}
              placeholder="defaults to the app name"
              onChange={(e) => setFromName(e.target.value)}
            />
          </div>
        </div>
        <div className="field">
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={secure}
              onChange={(e) => setSecure(e.target.checked)}
            />
            <span>Use implicit TLS (port 465). Leave off for STARTTLS (587).</span>
          </label>
        </div>
        {error && <p className="error">{error}</p>}
        {status && <p className="muted">{status}</p>}
        <div className="row-actions">
          <button className="btn" type="submit" disabled={saving || removing}>
            {saving ? "Saving…" : "Save email settings"}
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={remove}
            disabled={removing || saving}
          >
            {removing ? "Removing…" : "Remove settings"}
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
  const [syncEnabled, setSyncEnabled] = useState(false);
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
      setSyncEnabled(s.syncEnabled);
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
        syncEnabled,
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
      !(await dialog.confirm({
        message:
          "Remove the Mailchimp API key, server prefix, and audience? This cannot be undone.",
        danger: true,
      }))
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
      setSyncEnabled(cleared.syncEnabled);
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
        <div className="field">
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={syncEnabled}
              onChange={(e) => setSyncEnabled(e.target.checked)}
            />
            <span>
              Sync changes back to Mailchimp (dual-run). Off by default — the
              in-house contacts list is the system of record. Turn this on only
              during a migration window; importing from Mailchimp still works
              either way.
            </span>
          </label>
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
