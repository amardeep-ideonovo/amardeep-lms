"use client";

// Instance-slot tail shared by the portal Overview AND the "My instances"
// section: while under the license's effective cap it offers "Provision
// another instance"; at the cap it explains the limit (with an Upgrade CTA
// when a higher-cap active plan exists); a suspended license disables
// provisioning. Keeping this in one place is what guarantees a client can
// always add an instance anywhere their instances are shown.

import { FormEvent, useState } from "react";
import { Icon } from "@/components/icons";
import { UpgradeModal } from "@/components/portal-modals";
import { Field, Pill } from "@/components/ui";
import {
  activePlans,
  effectiveCap,
  provisionOwnInstance,
} from "@/lib/provisioner";
import type { ClientAccount, FleetState, Instance } from "@/lib/types";

export function ProvisionSlots({
  fleet,
  client,
  owned,
  suspended,
}: {
  fleet: FleetState;
  client: ClientAccount;
  owned: Instance[];
  suspended: boolean;
}) {
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const cap = effectiveCap(fleet, client.license);
  const underCap = owned.length < cap;
  const upgradeTarget = activePlans(fleet).some(
    (p) => p.id !== client.license.planId && p.instanceCap > cap
  );

  return (
    <>
      {underCap && !suspended && (
        <ProvisionAnotherCard client={client} used={owned.length} cap={cap} />
      )}
      {underCap && suspended && (
        <div className="card">
          <div className="empty-note" style={{ padding: "2px 0" }}>
            License suspended — provisioning is disabled until it&apos;s reactivated.
          </div>
        </div>
      )}
      {!underCap && (
        <div className="card onboard-card">
          <div className="card-head" style={{ marginBottom: 4 }}>
            <span className="card-title">Instance limit reached</span>
            <div className="card-head-spacer" />
            <Pill tone="neutral">
              {owned.length} of {cap} used
            </Pill>
          </div>
          <p className="modal-note" style={{ maxWidth: 460, margin: "6px 0 0" }}>
            {upgradeTarget
              ? cap === 1
                ? "Your plan includes a single instance — upgrade your plan to launch more academies on this license."
                : "Every instance slot on your license is in use — upgrade your plan to add more."
              : "Every instance slot on your license is in use — contact support to raise the cap."}
          </p>
          {upgradeTarget && (
            <button
              type="button"
              className="btn btn-primary"
              style={{ alignSelf: "flex-start", marginTop: 14 }}
              disabled={suspended}
              onClick={() => setUpgradeOpen(true)}
            >
              Upgrade plan
            </button>
          )}
        </div>
      )}

      {upgradeOpen && (
        <UpgradeModal fleet={fleet} client={client} onClose={() => setUpgradeOpen(false)} />
      )}
    </>
  );
}

// ---------- "Provision another instance" (under the cap) ----------

function ProvisionAnotherCard({
  client,
  used,
  cap,
}: {
  client: ClientAccount;
  used: number;
  cap: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Give the new instance a name — it appears on its member site.");
      return;
    }
    setError(null);
    setBusy(true);
    const result = await provisionOwnInstance(client.id, { name, domain });
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }
    setBusy(false);
    setExpanded(false);
    setName("");
    setDomain("");
  };

  return (
    <div className="card onboard-card">
      <div className="card-head" style={{ marginBottom: 4 }}>
        <span className="brow-icon" style={{ width: 34, height: 34 }}>
          <Icon name="arrow-up" size={15} />
        </span>
        <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span className="card-title">Provision another instance</span>
          <span className="card-sub">
            {used} of {cap} instances used on your license
          </span>
        </span>
        <div className="card-head-spacer" />
        {!expanded && (
          <button type="button" className="btn btn-primary" onClick={() => setExpanded(true)}>
            + New instance
          </button>
        )}
      </div>
      {expanded && (
        <form onSubmit={submit} className="modal-body" style={{ maxWidth: 480, marginTop: 10 }}>
          <Field label="Academy / site name">
            <input
              className="input"
              placeholder={`${client.academyName} Berlin`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </Field>
          <Field label="Domain" hint="Optional for now — point DNS whenever you're ready.">
            <input
              className="input mono"
              placeholder="berlin.youracademy.com"
              autoComplete="off"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
            />
          </Field>
          {error && <p className="form-error">{error}</p>}
          <div style={{ display: "flex", gap: 9 }}>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Starting the boot…" : "Provision instance"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setExpanded(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
