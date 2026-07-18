"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  ApiError,
  api,
  type EmailSettingsMasked,
  type PayPalSettingsMasked,
  type StripeSettingsMasked,
  type ZoomSettingsMasked,
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
      <EmailWebhookSecretSection />
      <ZoomSection />
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

function ZoomSection() {
  const [current, setCurrent] = useState<ZoomSettingsMasked | null>(null);
  const [removing, setRemoving] = useState(false);
  const [sdkKey, setSdkKey] = useState("");
  const [sdkSecret, setSdkSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setError(null);
    try {
      const s = await api.getZoomSettings();
      setCurrent(s);
      setSdkKey(s.sdkKey ?? "");
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load Zoom settings"
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
      const updated = await api.putZoomSettings({
        sdkKey: sdkKey.trim() || undefined,
        sdkSecret: sdkSecret.trim() || undefined,
      });
      setCurrent(updated);
      setSdkSecret("");
      setStatus("Zoom settings saved.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (
      !(await dialog.confirm({
        message: "Remove the Zoom SDK credentials?",
        danger: true,
      }))
    )
      return;
    setRemoving(true);
    setError(null);
    setStatus(null);
    try {
      const cleared = await api.clearZoomSettings();
      setCurrent(cleared);
      setSdkKey("");
      setSdkSecret("");
      setStatus("Zoom credentials removed.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Remove failed");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="card">
      <h2>Zoom (in-page live sessions)</h2>
      <p className="subtitle">
        From a Zoom “Meeting SDK” app at marketplace.zoom.us. Lets Zoom live
        sessions play inside the member’s page instead of opening a new tab.
        Google Meet always opens in a new tab (Google doesn’t allow embedding).
      </p>
      <form onSubmit={save}>
        <div className="field">
          <label>
            SDK key <span className="muted">(public)</span>
          </label>
          <input
            value={sdkKey}
            placeholder="Zoom Meeting SDK key"
            onChange={(e) => setSdkKey(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label>
            SDK secret{" "}
            <span className="muted">
              (current: {masked(current?.sdkSecretLast4 ?? null)})
            </span>
          </label>
          <input
            type="password"
            value={sdkSecret}
            placeholder="Zoom Meeting SDK secret  (leave blank to keep)"
            onChange={(e) => setSdkSecret(e.target.value)}
            autoComplete="off"
          />
        </div>
        {error && <p className="error">{error}</p>}
        {status && <p className="muted">{status}</p>}
        <div className="row-actions">
          <button className="btn" type="submit" disabled={saving || removing}>
            {saving ? "Saving…" : "Save Zoom settings"}
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

// Outbound email sender (in-house email platform). A pluggable provider
// (SMTP via nodemailer, or Resend via REST) carries transactional + campaign
// mail. The From address is shared by both providers; the per-provider secret
// (SMTP password / Resend API key) is write-only — blank keeps the stored value
// and the form only ever shows whether one is set.
function EmailSenderSection() {
  const [current, setCurrent] = useState<EmailSettingsMasked | null>(null);
  const [removing, setRemoving] = useState(false);
  const [provider, setProvider] = useState<"smtp" | "resend">("smtp");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [resendApiKey, setResendApiKey] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [secure, setSecure] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Mirror the loaded (non-secret) config into the editable fields.
  function hydrate(s: EmailSettingsMasked) {
    setCurrent(s);
    setProvider(s.provider);
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
      // Always send the chosen provider + shared From; send each secret only
      // when the admin typed one (blank keeps the stored value).
      const updated = await api.putEmailSettings({
        provider,
        host: host.trim() || undefined,
        port: port.trim() || undefined,
        user: user.trim() || undefined,
        pass: pass.trim() || undefined,
        resendApiKey: resendApiKey.trim() || undefined,
        fromEmail: fromEmail.trim() || undefined,
        fromName: fromName.trim() || undefined,
        secure,
      });
      hydrate(updated);
      setPass("");
      setResendApiKey("");
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
          "Remove the email provider settings (SMTP host/credentials, Resend key, and From address)? This cannot be undone.",
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
      setResendApiKey("");
      setStatus("Email settings removed.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Remove failed");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="card">
      <h2>Email sender</h2>
      <p className="muted">
        Transactional and campaign email is sent through the selected provider.
        Until it’s configured, messages (like the signup welcome) are logged but
        not delivered.
      </p>
      <form onSubmit={save}>
        <div className="field" style={{ display: "grid", gap: 6 }}>
          <label>Provider</label>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {(
              [
                { value: "smtp", label: "SMTP" },
                { value: "resend", label: "Resend" },
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
                  name="emailProvider"
                  checked={provider === o.value}
                  onChange={() => setProvider(o.value)}
                />
                <span>{o.label}</span>
                {current?.provider === o.value && (
                  <span className="badge badge--ok">Active</span>
                )}
              </label>
            ))}
          </div>
        </div>

        {provider === "smtp" && (
          <>
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
          </>
        )}

        {provider === "resend" && (
          <div className="field">
            <label>
              Resend API key{" "}
              <span className="muted">
                ({current?.resendApiKeySet ? "configured" : "not set"})
              </span>
            </label>
            <input
              type="password"
              value={resendApiKey}
              placeholder="re_…  (leave blank to keep)"
              onChange={(e) => setResendApiKey(e.target.value)}
              autoComplete="off"
            />
            <p className="muted">
              Add your Resend API key (re_…) and a From address on a domain
              you’ve verified in Resend. Get a key at resend.com.
            </p>
          </div>
        )}

        <div className="form-row">
          <div className="field">
            <label>From email</label>
            <input
              value={fromEmail}
              placeholder={
                provider === "resend"
                  ? "hello@your-verified-domain.com"
                  : "hello@yourdomain.com"
              }
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

        {provider === "smtp" && (
          <div className="field">
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={secure}
                onChange={(e) => setSecure(e.target.checked)}
              />
              <span>
                Use implicit TLS (port 465). Leave off for STARTTLS (587).
              </span>
            </label>
          </div>
        )}

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

// The shared secret that authenticates the provider's bounce/complaint webhook.
// Without it the webhook fails closed, so no delivery failures are ingested and
// the suppression list never populates. This wires the existing (previously
// UI-less) backend endpoints so an admin can actually turn suppression on.
function EmailWebhookSecretSection() {
  const [secretSet, setSecretSet] = useState<boolean | null>(null);
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const s = await api.getEmailWebhookSecret();
      setSecretSet(s.secretSet);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load");
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!secret.trim()) return;
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const s = await api.putEmailWebhookSecret(secret.trim());
      setSecretSet(s.secretSet);
      setSecret("");
      setStatus(
        "Webhook secret saved. Bounce/complaint suppression is now active.",
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    if (
      !(await dialog.confirm({
        message:
          "Clear the email webhook secret? The bounce/complaint webhook will stop being accepted until a new secret is set, and suppression will pause.",
        danger: true,
      }))
    )
      return;
    setClearing(true);
    setError(null);
    setStatus(null);
    try {
      const s = await api.deleteEmailWebhookSecret();
      setSecretSet(s.secretSet);
      setStatus("Webhook secret cleared.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Clear failed");
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="card">
      <h2>Email webhook secret</h2>
      <p className="muted">
        Shared secret that authenticates your provider&rsquo;s bounce/complaint
        webhook. Until it&rsquo;s set, delivery failures aren&rsquo;t ingested
        and the unsubscribe/suppression list never populates. Set the same value
        here and in your email provider&rsquo;s webhook (Resend / SES / Svix).
      </p>
      <form onSubmit={save}>
        <div className="field">
          <label htmlFor="email-webhook-secret">Webhook signing secret</label>
          <input
            id="email-webhook-secret"
            type="password"
            value={secret}
            placeholder={
              secretSet
                ? "A secret is set — enter a new value to rotate"
                : "Not set — paste your provider's webhook secret"
            }
            onChange={(e) => setSecret(e.target.value)}
          />
        </div>
        <p className="muted">
          Status:{" "}
          {secretSet === null ? (
            "…"
          ) : secretSet ? (
            <span className="badge badge--ok">Configured</span>
          ) : (
            <span className="badge">Not set</span>
          )}
        </p>
        {error && <p className="error">{error}</p>}
        {status && <p className="muted">{status}</p>}
        <div className="row-actions">
          <button
            className="btn"
            type="submit"
            disabled={saving || clearing || !secret.trim()}
          >
            {saving ? "Saving…" : "Save secret"}
          </button>
          {secretSet && (
            <button
              type="button"
              className="btn btn--danger"
              onClick={clear}
              disabled={clearing || saving}
            >
              {clearing ? "Clearing…" : "Clear secret"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
