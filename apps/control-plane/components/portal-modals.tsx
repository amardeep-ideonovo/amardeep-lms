"use client";

// Client-portal dialogs shared by the Overview page and the section pages:
// restore (type-the-id confirm), new ticket, request mobile build, manage
// billing, upgrade plan, changelog.

import { useMemo, useState } from "react";
import {
  changePlan,
  createTicket,
  downloadBackup,
  PLAN_PRICE,
  requestMobileBuilds,
  restoreBackup,
  updateCard,
} from "@/lib/provisioner";
import type { Instance, PlanTier } from "@/lib/types";
import { Field, Modal } from "./ui";

// ---------- backup download (mock manifest as a real file download) ----------

export async function handleDownloadBackup(instanceId: string, entryId?: string): Promise<void> {
  const file = await downloadBackup(instanceId, entryId);
  if (!file) return;
  const blob = new Blob([file.contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------- restore (confirm by typing the instance id) ----------

export function RestoreModal({ instance, onClose }: { instance: Instance; onClose: () => void }) {
  const entries = instance.backups.entries;
  const [entryId, setEntryId] = useState(entries[0]?.id ?? "");
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const canRestore = confirmText.trim() === instance.id && entryId !== "";

  return (
    <Modal title="Restore backup" onClose={onClose} width={480}>
      <div className="modal-body">
        <div className="danger-box">
          This overwrites the live database and uploads for{" "}
          <span className="mono">{instance.domain}</span> with the selected snapshot. Members see
          maintenance mode while it runs.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {entries.map((entry) => (
            <label key={entry.id} className={`radio-row${entryId === entry.id ? " checked" : ""}`}>
              <input
                type="radio"
                name="backup-entry"
                checked={entryId === entry.id}
                onChange={() => setEntryId(entry.id)}
              />
              <span className="radio-main">
                <span className="radio-title">{entry.label}</span>
                <span className="radio-sub">{entry.detail}</span>
              </span>
            </label>
          ))}
        </div>
        <Field
          label={`Type the instance id (${instance.id}) to confirm`}
          hint="The restore runs against this instance's own volumes only."
        >
          <input
            className="input mono"
            placeholder={instance.id}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            autoComplete="off"
          />
        </Field>
      </div>
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-danger"
          disabled={!canRestore || busy}
          onClick={async () => {
            setBusy(true);
            await restoreBackup(instance.id, entryId);
            onClose();
          }}
        >
          {busy ? "Starting…" : "Restore"}
        </button>
      </div>
    </Modal>
  );
}

// ---------- new support ticket ----------

export function NewTicketModal({ instance, onClose }: { instance: Instance; onClose: () => void }) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="New ticket" onClose={onClose} width={440}>
      <div className="modal-body">
        <Field label="Subject">
          <input
            className="input"
            placeholder="What do you need help with?"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            autoFocus
          />
        </Field>
        <Field label="Message" hint="Average first response: 4h on the Pro plan.">
          <textarea
            className="input"
            placeholder="Add any details, URLs, or member emails…"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </Field>
      </div>
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || subject.trim().length < 3}
          onClick={async () => {
            setBusy(true);
            await createTicket(instance.id, subject.trim());
            onClose();
          }}
        >
          {busy ? "Sending…" : "Send ticket"}
        </button>
      </div>
    </Modal>
  );
}

// ---------- request mobile builds ----------

export function RequestBuildModal({ instance, onClose }: { instance: Instance; onClose: () => void }) {
  const [ios, setIos] = useState(true);
  const [android, setAndroid] = useState(true);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Request build" onClose={onClose} width={420}>
      <div className="modal-body">
        <p className="modal-note">
          Queues a white-label build on the per-client EAS track. The binary points at this instance's
          API and ships from your own store accounts.
        </p>
        <label className={`radio-row${ios ? " checked" : ""}`}>
          <input type="checkbox" checked={ios} onChange={(e) => setIos(e.target.checked)} />
          <span className="radio-main">
            <span className="radio-title">iOS — {instance.clientName}</span>
            <span className="radio-sub">
              {instance.mobileBuilds.ios.version} · {instance.mobileBuilds.ios.detail}
            </span>
          </span>
        </label>
        <label className={`radio-row${android ? " checked" : ""}`}>
          <input type="checkbox" checked={android} onChange={(e) => setAndroid(e.target.checked)} />
          <span className="radio-main">
            <span className="radio-title">Android — {instance.clientName}</span>
            <span className="radio-sub">
              {instance.mobileBuilds.android.version} · {instance.mobileBuilds.android.detail}
            </span>
          </span>
        </label>
      </div>
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || (!ios && !android)}
          onClick={async () => {
            setBusy(true);
            await requestMobileBuilds(instance.id, { ios, android });
            onClose();
          }}
        >
          {busy ? "Queuing…" : "Request build"}
        </button>
      </div>
    </Modal>
  );
}

// ---------- manage billing (card on file) ----------

export function ManageBillingModal({ instance, onClose }: { instance: Instance; onClose: () => void }) {
  const [brand, setBrand] = useState(instance.license.cardBrand);
  const [last4, setLast4] = useState(instance.license.cardLast4);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Manage billing" onClose={onClose} width={420}>
      <div className="modal-body">
        <p className="modal-note">
          {instance.license.plan} — ${instance.license.priceMonthly}/month · renews{" "}
          {instance.license.renewsAt}. In production this opens the hosted billing portal.
        </p>
        <Field label="Card brand">
          <select className="input" value={brand} onChange={(e) => setBrand(e.target.value)}>
            <option>Visa</option>
            <option>Mastercard</option>
            <option>Amex</option>
          </select>
        </Field>
        <Field label="Card (last 4 digits)">
          <input
            className="input mono"
            maxLength={4}
            value={last4}
            onChange={(e) => setLast4(e.target.value.replace(/\D/g, ""))}
          />
        </Field>
      </div>
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || last4.length !== 4}
          onClick={async () => {
            setBusy(true);
            await updateCard(instance.id, brand, last4);
            onClose();
          }}
        >
          {busy ? "Saving…" : "Save card"}
        </button>
      </div>
    </Modal>
  );
}

// ---------- upgrade / change plan ----------

const PLAN_BLURBS: Record<PlanTier, string> = {
  Starter: "500 members · web only · weekly backups",
  Pro: "5,000 members · mobile apps · daily backups · 4h support",
  Scale: "Unlimited members · dedicated host · hourly backups · SLA 99.9%",
};

export function UpgradeModal({ instance, onClose }: { instance: Instance; onClose: () => void }) {
  const [plan, setPlan] = useState<PlanTier>(instance.license.plan);
  const [busy, setBusy] = useState(false);
  const tiers = useMemo(() => Object.keys(PLAN_PRICE) as PlanTier[], []);
  return (
    <Modal title="Change plan" onClose={onClose} width={440}>
      <div className="modal-body">
        {tiers.map((tier) => (
          <label key={tier} className={`radio-row${plan === tier ? " checked" : ""}`}>
            <input type="radio" name="plan" checked={plan === tier} onChange={() => setPlan(tier)} />
            <span className="radio-main">
              <span className="radio-title">
                {tier} — ${PLAN_PRICE[tier]}/mo{tier === instance.license.plan ? " (current)" : ""}
              </span>
              <span className="radio-sub">{PLAN_BLURBS[tier]}</span>
            </span>
          </label>
        ))}
        <p className="modal-note">Changes prorate on the next invoice. Your instance is untouched.</p>
      </div>
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || plan === instance.license.plan}
          onClick={async () => {
            setBusy(true);
            await changePlan(instance.id, plan);
            onClose();
          }}
        >
          {busy ? "Updating…" : `Switch to ${plan}`}
        </button>
      </div>
    </Modal>
  );
}

// ---------- changelog ----------

const CHANGELOG: Array<{ version: string; date: string; lines: string[] }> = [
  {
    version: "v1.8.2",
    date: "Jul 2026",
    lines: [
      "Live-session waiting rooms with host admit controls",
      "Uploads pipeline is ~2× faster on large video files",
      "Certificate PDFs render custom fonts more reliably",
    ],
  },
  {
    version: "v1.8.1",
    date: "Jun 2026",
    lines: [
      "One-off course purchases (lifetime access) beside subscriptions",
      "Password reset for members",
      "Email deliverability fixes for transactional sends",
    ],
  },
  {
    version: "v1.7.9",
    date: "May 2026",
    lines: ["Admin bulk member import", "Faster reports on large academies"],
  },
];

export function ChangelogModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Changelog" onClose={onClose} width={460}>
      <div className="modal-body">
        {CHANGELOG.map((release) => (
          <div key={release.version}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
              <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: "var(--text-ink)" }}>
                {release.version}
              </span>
              <span className="card-sub">{release.date}</span>
            </div>
            {release.lines.map((line) => (
              <div key={line} className="boot-step" style={{ padding: "4px 0" }}>
                <span className="boot-num">•</span>
                {line}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
