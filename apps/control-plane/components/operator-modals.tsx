"use client";

// Operator-console dialogs: plan catalog editor, and the per-license control
// verbs (change plan, cap override, app-track override, provision-for-client).

import { FormEvent, useState } from "react";
import {
  activePlans,
  changeLicensePlan,
  clientInstances,
  createPlan,
  effectiveCap,
  effectiveTrack,
  getPlan,
  provisionOwnInstance,
  setLicenseCapOverride,
  setLicenseTrackOverride,
  trackLabel,
  updatePlan,
  type PlanInput,
} from "@/lib/provisioner";
import type { AppTrack, ClientAccount, FleetState, Plan } from "@/lib/types";
import { Field, Modal } from "./ui";

// ---------- app-track radio cards (shared by plan editor + track override) ----------

const TRACK_OPTIONS: Array<{ value: AppTrack; title: string; sub: string }> = [
  {
    value: "none",
    title: "Web only",
    sub: "No mobile apps — member site and admin panel in the browser.",
  },
  {
    value: "shared",
    title: "Shared Spotlight app",
    sub: "Clients hand members a connect code for the shared store app.",
  },
  {
    value: "whitelabel",
    title: "White-label",
    sub: "Branded builds shipped to the client's own store listings.",
  },
];

function TrackRadios({
  value,
  onChange,
  name,
  extra,
}: {
  value: AppTrack | null;
  onChange: (t: AppTrack | null) => void;
  name: string;
  /** Optional leading option (e.g. "Plan default"). */
  extra?: { title: string; sub: string };
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {extra && (
        <label className={`radio-row${value === null ? " checked" : ""}`}>
          <input type="radio" name={name} checked={value === null} onChange={() => onChange(null)} />
          <span className="radio-main">
            <span className="radio-title">{extra.title}</span>
            <span className="radio-sub">{extra.sub}</span>
          </span>
        </label>
      )}
      {TRACK_OPTIONS.map((opt) => (
        <label key={opt.value} className={`radio-row${value === opt.value ? " checked" : ""}`}>
          <input
            type="radio"
            name={name}
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
          />
          <span className="radio-main">
            <span className="radio-title">{opt.title}</span>
            <span className="radio-sub">{opt.sub}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

// ---------- plan editor (create + edit) ----------

export function PlanEditorModal({ plan, onClose }: { plan: Plan | null; onClose: () => void }) {
  const [name, setName] = useState(plan?.name ?? "");
  const [blurb, setBlurb] = useState(plan?.blurb ?? "");
  const [price, setPrice] = useState(plan ? String(plan.priceMonthly) : "");
  const [cap, setCap] = useState(plan ? String(plan.instanceCap) : "1");
  const [track, setTrack] = useState<AppTrack>(plan?.appTrack ?? "none");
  const [features, setFeatures] = useState(plan?.features.join("\n") ?? "");
  const [featured, setFeatured] = useState(plan?.featured ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const priceNum = Number(price);
    const capNum = Number(cap);
    if (!name.trim()) return setError("Give the plan a name.");
    if (!Number.isFinite(priceNum) || priceNum < 0)
      return setError("Monthly price must be a number (USD).");
    if (!Number.isInteger(capNum) || capNum < 1)
      return setError("Instance cap must be a whole number of 1 or more.");
    const input: PlanInput = {
      name: name.trim(),
      blurb: blurb.trim(),
      priceMonthly: priceNum,
      instanceCap: capNum,
      appTrack: track,
      features: features
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean),
      featured,
    };
    setBusy(true);
    if (plan) await updatePlan(plan.id, input);
    else await createPlan(input);
    onClose();
  };

  return (
    <Modal title={plan ? `Edit plan — ${plan.name}` : "New plan"} onClose={onClose} width={520}>
      <form onSubmit={submit}>
        <div className="modal-body">
          <div className="wizard-two-col">
            <Field label="Plan name">
              <input
                className="input"
                placeholder="Growth"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus={!plan}
              />
            </Field>
            <Field label="Blurb" hint="One line under the name on the pricing cards.">
              <input
                className="input"
                placeholder="For a growing academy"
                value={blurb}
                onChange={(e) => setBlurb(e.target.value)}
              />
            </Field>
          </div>
          <div className="wizard-two-col">
            <Field label="Monthly price (USD)">
              <input
                className="input mono"
                inputMode="numeric"
                placeholder="249"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </Field>
            <Field label="Instance cap" hint="How many instances a license may run.">
              <input
                className="input mono"
                inputMode="numeric"
                placeholder="1"
                value={cap}
                onChange={(e) => setCap(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Mobile app track">
            <TrackRadios name="plan-track" value={track} onChange={(t) => setTrack(t ?? "none")} />
          </Field>
          <Field label="Features" hint="One per line — rendered verbatim on sales, signup and billing.">
            <textarea
              className="input"
              placeholder={"1 instance · your domain\nUp to 5,000 members"}
              value={features}
              onChange={(e) => setFeatures(e.target.value)}
            />
          </Field>
          <label className={`radio-row${featured ? " checked" : ""}`}>
            <input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} />
            <span className="radio-main">
              <span className="radio-title">Featured</span>
              <span className="radio-sub">Dark card + “MOST POPULAR” ribbon on sales and signup.</span>
            </span>
          </label>
          {error && <p className="form-error">{error}</p>}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Saving…" : plan ? "Save plan" : "Create plan"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- change plan (license → another catalog plan) ----------

export function ChangeLicensePlanModal({
  fleet,
  client,
  onClose,
}: {
  fleet: FleetState;
  client: ClientAccount;
  onClose: () => void;
}) {
  const current = getPlan(fleet, client.license.planId);
  const owned = clientInstances(fleet, client.id).length;
  const choices = activePlans(fleet);
  const list = current && !choices.some((p) => p.id === current.id) ? [current, ...choices] : choices;
  const [planId, setPlanId] = useState(client.license.planId);
  const [busy, setBusy] = useState(false);

  return (
    <Modal title={`Change plan — ${client.academyName}`} onClose={onClose} width={460}>
      <div className="modal-body">
        {list.map((p) => {
          const capAfter = client.license.instanceCapOverride ?? p.instanceCap;
          const tooSmall = capAfter < owned;
          return (
            <label
              key={p.id}
              className={`radio-row${planId === p.id ? " checked" : ""}`}
              style={tooSmall ? { opacity: 0.55 } : undefined}
            >
              <input
                type="radio"
                name="license-plan"
                checked={planId === p.id}
                disabled={tooSmall}
                onChange={() => setPlanId(p.id)}
              />
              <span className="radio-main">
                <span className="radio-title">
                  {p.name} — ${p.priceMonthly}/mo{p.id === client.license.planId ? " (current)" : ""}
                  {!p.active ? " · off sale" : ""}
                </span>
                <span className="radio-sub">
                  {tooSmall
                    ? `Needs a cap of ${owned}+ — the client runs ${owned} instances`
                    : `${p.blurb} · cap ${p.instanceCap} · ${trackLabel(p.appTrack)}`}
                </span>
              </span>
            </label>
          );
        })}
        <p className="modal-note">
          Repricing lands on the next invoice. Cap and app track follow the new plan (per-license
          overrides stay).
        </p>
      </div>
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || planId === client.license.planId}
          onClick={async () => {
            setBusy(true);
            await changeLicensePlan(client.id, planId, "operator");
            onClose();
          }}
        >
          {busy ? "Updating…" : `Switch to ${list.find((p) => p.id === planId)?.name ?? "plan"}`}
        </button>
      </div>
    </Modal>
  );
}

// ---------- instance-cap override ----------

export function CapOverrideModal({
  fleet,
  client,
  onClose,
}: {
  fleet: FleetState;
  client: ClientAccount;
  onClose: () => void;
}) {
  const plan = getPlan(fleet, client.license.planId);
  const planCap = plan?.instanceCap ?? 1;
  const owned = clientInstances(fleet, client.id).length;
  const [value, setValue] = useState(
    typeof client.license.instanceCapOverride === "number"
      ? String(client.license.instanceCapOverride)
      : ""
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    let cap: number | null = null;
    if (trimmed !== "") {
      const n = Number(trimmed);
      if (!Number.isInteger(n) || n < 1) {
        setError("Enter a whole number of 1 or more, or leave blank to clear the override.");
        return;
      }
      if (n < owned) {
        setError(`The client already runs ${owned} instances — the cap can't go below that.`);
        return;
      }
      cap = n;
    }
    setBusy(true);
    await setLicenseCapOverride(client.id, cap);
    onClose();
  };

  return (
    <Modal title={`Instance cap — ${client.academyName}`} onClose={onClose} width={420}>
      <form onSubmit={submit}>
        <div className="modal-body">
          <p className="modal-note">
            Plan default ({plan?.name ?? client.license.planId}): <b>{planCap}</b> instance
            {planCap === 1 ? "" : "s"} · currently using {owned}.
          </p>
          <Field label="Cap override" hint="Leave blank to clear the override and use the plan default.">
            <input
              className="input mono"
              inputMode="numeric"
              placeholder={`${planCap} (plan default)`}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
            />
          </Field>
          {error && <p className="form-error">{error}</p>}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Save cap"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- app-track override ----------

export function TrackOverrideModal({
  fleet,
  client,
  onClose,
}: {
  fleet: FleetState;
  client: ClientAccount;
  onClose: () => void;
}) {
  const plan = getPlan(fleet, client.license.planId);
  const [track, setTrack] = useState<AppTrack | null>(client.license.appTrackOverride ?? null);
  const [busy, setBusy] = useState(false);

  return (
    <Modal title={`App track — ${client.academyName}`} onClose={onClose} width={460}>
      <div className="modal-body">
        <TrackRadios
          name="track-override"
          value={track}
          onChange={setTrack}
          extra={{
            title: `Plan default — ${trackLabel(plan?.appTrack ?? "none")}`,
            sub: `Follow ${plan?.name ?? "the plan"} (changes if the plan changes).`,
          }}
        />
      </div>
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await setLicenseTrackOverride(client.id, track);
            onClose();
          }}
        >
          {busy ? "Saving…" : "Save track"}
        </button>
      </div>
    </Modal>
  );
}

// ---------- provision an instance FOR a client (operator, respects the cap) ----------

export function ProvisionForClientModal({
  fleet,
  client,
  onClose,
}: {
  fleet: FleetState;
  client: ClientAccount;
  onClose: () => void;
}) {
  const owned = clientInstances(fleet, client.id).length;
  const cap = effectiveCap(fleet, client.license);
  const suspended = client.license.status === "suspended";
  const atCap = owned >= cap;
  const [name, setName] = useState(owned === 0 ? client.academyName : "");
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("Give the instance a name — it appears on the member site.");
    setBusy(true);
    const result = await provisionOwnInstance(client.id, { name, domain }, "operator");
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }
    onClose();
  };

  return (
    <Modal title={`Provision for ${client.academyName}`} onClose={onClose} width={460}>
      <form onSubmit={submit}>
        <div className="modal-body">
          <p className="modal-note">
            Uses {client.academyName}'s license slot {Math.min(owned + 1, cap)} of {cap} (
            {trackLabel(effectiveTrack(fleet, client.license))} track). Same pipeline as the portal
            onboarding — isolated stack, seeded first admin for {client.email}.
          </p>
          {suspended && (
            <div className="danger-box">License suspended — resume it before provisioning.</div>
          )}
          {!suspended && atCap && (
            <div className="warn-box">
              Instance limit reached — {owned} of {cap} used. Change the plan or override the cap
              first.
            </div>
          )}
          <Field label="Academy / site name">
            <input
              className="input"
              placeholder="Harbor Yoga Berlin"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </Field>
          <Field label="Domain" hint="Optional — a spotlightlms.site subdomain is used until DNS points over.">
            <input
              className="input mono"
              placeholder="berlin.harboryoga.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
            />
          </Field>
          {error && <p className="form-error">{error}</p>}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || atCap || suspended}>
            {busy ? "Provisioning…" : "Provision instance"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
