"use client";

// Operator sidebar sections — small live views over the same fleet store so
// no nav item is dead: provisioning, updates, backups, licenses, clients,
// billing, hosts, alerts, audit, settings.

import { notFound } from "next/navigation";
import { useState } from "react";
import { AddHostModal } from "@/components/AddHostModal";
import { RolloutCard } from "@/components/RolloutCard";
import { Icon } from "@/components/icons";
import { HealthLabel, PageSkeleton, Pill } from "@/components/ui";
import {
  displayStatus,
  initialsOf,
  resolveAlert,
  updateSettings,
} from "@/lib/provisioner";
import { useFleet } from "@/lib/useFleet";
import type { FleetState, Instance } from "@/lib/types";
import { SECTIONS, type Section } from "./sections";





export default function OperatorSection({ section: sectionParam }: { section: string }) {
  const fleet = useFleet();
  if (!SECTIONS.includes(sectionParam as Section)) notFound();
  if (!fleet) return <PageSkeleton />;

  const section = sectionParam as Section;
  return (
    <div className="stack page-in">
      {section === "provisioning" && <ProvisioningView fleet={fleet} />}
      {section === "updates" && <UpdatesView fleet={fleet} />}
      {section === "backups" && <BackupsView fleet={fleet} />}
      {section === "licenses" && <LicensesView fleet={fleet} />}
      {section === "clients" && <ClientsView fleet={fleet} />}
      {section === "billing" && <BillingView fleet={fleet} />}
      {section === "hosts" && <HostsView fleet={fleet} />}
      {section === "alerts" && <AlertsView fleet={fleet} />}
      {section === "audit" && <AuditView fleet={fleet} />}
      {section === "settings" && <SettingsView fleet={fleet} />}
    </div>
  );
}

// ---------- shared bits ----------

function InstCell({ inst }: { inst: Instance }) {
  return (
    <span className="inst-cell">
      <span className="inst-tile">{initialsOf(inst.clientName)}</span>
      <span className="inst-text">
        <span className="inst-name">{inst.clientName}</span>
        <span className="inst-domain">{inst.domain}</span>
      </span>
    </span>
  );
}

function filtered(fleet: FleetState): Instance[] {
  const q = fleet.ui.instanceQuery.trim().toLowerCase();
  if (!q) return fleet.instances;
  return fleet.instances.filter(
    (i) =>
      i.clientName.toLowerCase().includes(q) ||
      i.domain.toLowerCase().includes(q) ||
      i.id.includes(q) ||
      i.owner.toLowerCase().includes(q)
  );
}

// ---------- provisioning ----------

function ProvisioningView({ fleet }: { fleet: FleetState }) {
  const provisioning = fleet.instances.filter((i) => i.status === "Provisioning");
  return (
    <>
      <div className="card">
        <div className="card-head" style={{ marginBottom: 10 }}>
          <span className="card-title">Provisioning jobs</span>
          <span className="card-sub">
            {provisioning.length === 0 ? "none running" : `${provisioning.length} booting`}
          </span>
        </div>
        {provisioning.map((inst) => (
          <div key={inst.id} className="brow">
            <span className="brow-icon">
              <span className="wave-dot active pulse" style={{ background: "var(--info-text)" }} />
            </span>
            <span className="brow-body">
              <span className="brow-title">{inst.clientName}</span>
              <span className="brow-meta mono">
                {inst.dbName} · {inst.domain} · ports {inst.ports.api}/{inst.ports.web}/{inst.ports.admin}
              </span>
            </span>
            <Pill tone="info">Provisioning</Pill>
          </div>
        ))}
        {provisioning.length === 0 && (
          <div className="empty-note">
            Nothing booting right now — use “+ Provision instance” in the top bar to bring up a new
            isolated stack.
          </div>
        )}
      </div>
      <div className="card">
        <div className="card-title" style={{ marginBottom: 8 }}>
          What a provision runs
        </div>
        {fleet.bootSteps.map((step, idx) => (
          <div key={step} className="boot-step">
            <span className="boot-num">{idx + 1}</span>
            {step}
          </div>
        ))}
      </div>
    </>
  );
}

// ---------- updates ----------

function UpdatesView({ fleet }: { fleet: FleetState }) {
  const target = fleet.rollout.targetVersion;
  return (
    <div className="grid-main-rail">
      <div className="card">
        <div className="card-head" style={{ marginBottom: 6 }}>
          <span className="card-title">Fleet versions</span>
          <span className="card-sub">target {target}</span>
        </div>
        <table className="itable">
          <thead>
            <tr>
              <th>Instance</th>
              <th>Current</th>
              <th>Target</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {filtered(fleet).map((inst) => {
              const updated = inst.version === target;
              return (
                <tr key={inst.id}>
                  <td>
                    <InstCell inst={inst} />
                  </td>
                  <td className="cell-version">{inst.version}</td>
                  <td className="cell-version">{target}</td>
                  <td>
                    {updated ? (
                      <Pill tone="success">Updated</Pill>
                    ) : inst.updateScheduled ? (
                      <Pill tone="warning">Scheduled tonight</Pill>
                    ) : inst.updateQueued ? (
                      <Pill tone="warning">Update queued</Pill>
                    ) : inst.status === "Suspended" ? (
                      <Pill tone="neutral">On hold</Pill>
                    ) : (
                      <Pill tone="info">Waiting on wave</Pill>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <RolloutCard rollout={fleet.rollout} />
    </div>
  );
}

// ---------- backups ----------

function BackupsView({ fleet }: { fleet: FleetState }) {
  const failedAlert = fleet.alerts.find((a) => a.id === "a-backup-luthier" && !a.resolved);
  return (
    <div className="card">
      <div className="card-head" style={{ marginBottom: 6 }}>
        <span className="card-title">Fleet backups</span>
        <span className="card-sub">pg_dump + uploads volume, verified after every run</span>
      </div>
      <table className="itable">
        <thead>
          <tr>
            <th>Instance</th>
            <th>Schedule</th>
            <th>Last run</th>
            <th>Size</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {filtered(fleet).map((inst) => {
            const failed = inst.id === "luthier" && !!failedAlert;
            return (
              <tr key={inst.id}>
                <td>
                  <InstCell inst={inst} />
                </td>
                <td>{inst.backups.schedule}</td>
                <td>{inst.backups.lastRunAt}</td>
                <td>{inst.backups.sizeMb > 0 ? `${(inst.backups.sizeMb / 1024).toFixed(1)} GB` : "—"}</td>
                <td>
                  {failed ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <Pill tone="danger">Failed</Pill>
                      <button
                        type="button"
                        className="chip-action"
                        onClick={() => resolveAlert("a-backup-luthier")}
                      >
                        Re-run
                      </button>
                    </span>
                  ) : inst.backups.sizeMb === 0 ? (
                    <Pill tone="neutral">Pending first run</Pill>
                  ) : inst.backups.verified ? (
                    <Pill tone="success">Verified</Pill>
                  ) : (
                    <Pill tone="warning">Unverified</Pill>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------- licenses ----------

function LicensesView({ fleet }: { fleet: FleetState }) {
  return (
    <div className="card">
      <div className="card-head" style={{ marginBottom: 6 }}>
        <span className="card-title">Licenses</span>
        <span className="card-sub">1 license = 1 fully isolated instance</span>
      </div>
      <table className="itable">
        <thead>
          <tr>
            <th>Client</th>
            <th>Plan</th>
            <th>Price</th>
            <th>Renews</th>
            <th>Card</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {filtered(fleet).map((inst) => {
            const status = displayStatus(inst);
            return (
              <tr key={inst.id}>
                <td>
                  <InstCell inst={inst} />
                </td>
                <td>{inst.license.plan}</td>
                <td>${inst.license.priceMonthly}/mo</td>
                <td>{inst.license.renewsAt}</td>
                <td>
                  {inst.license.cardBrand} •••• {inst.license.cardLast4}
                </td>
                <td>
                  {inst.status === "Suspended" ? (
                    <Pill tone="neutral">Lapsed</Pill>
                  ) : (
                    <Pill tone={status.tone === "neutral" ? "neutral" : "success"}>Active</Pill>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------- clients ----------

function ClientsView({ fleet }: { fleet: FleetState }) {
  return (
    <div className="card">
      <div className="card-head" style={{ marginBottom: 6 }}>
        <span className="card-title">Clients</span>
        <span className="card-sub">{fleet.instances.length} on this page · license holders</span>
      </div>
      <table className="itable">
        <thead>
          <tr>
            <th>Client</th>
            <th>Owner</th>
            <th>Members</th>
            <th>Since</th>
            <th>Open tickets</th>
          </tr>
        </thead>
        <tbody>
          {filtered(fleet).map((inst) => (
            <tr key={inst.id}>
              <td>
                <InstCell inst={inst} />
              </td>
              <td>{inst.owner}</td>
              <td>{inst.membersCount === null ? "—" : inst.membersCount.toLocaleString("en-US")}</td>
              <td>{inst.createdAt}</td>
              <td>
                {inst.tickets.filter((t) => t.status === "Open").length > 0 ? (
                  <Pill tone="danger">{inst.tickets.filter((t) => t.status === "Open").length} open</Pill>
                ) : (
                  <Pill tone="neutral">none</Pill>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- billing ----------

function BillingView({ fleet }: { fleet: FleetState }) {
  const arr = fleet.stats.mrr * 12;
  return (
    <>
      <div className="stat-grid" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
        <div className="stat-card">
          <span className="stat-icon tint-warning">
            <Icon name="credit-card" size={17} />
          </span>
          <span>
            <span className="stat-label">Fleet MRR</span>
            <span className="stat-value">${fleet.stats.mrr.toLocaleString("en-US")}</span>
            <span className="stat-note tone-success">{fleet.stats.mrrNote}</span>
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-icon tint-success">
            <Icon name="shield" size={17} />
          </span>
          <span>
            <span className="stat-label">Annual run rate</span>
            <span className="stat-value">${arr.toLocaleString("en-US")}</span>
            <span className="stat-note tone-success">{fleet.stats.licenses} licenses</span>
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-icon tint-info">
            <Icon name="users" size={17} />
          </span>
          <span>
            <span className="stat-label">Avg per license</span>
            <span className="stat-value">
              ${Math.round(fleet.stats.mrr / Math.max(1, fleet.stats.licenses))}
            </span>
            <span className="stat-note tone-info">USD, monthly</span>
          </span>
        </div>
      </div>
      <div className="card">
        <div className="card-head" style={{ marginBottom: 6 }}>
          <span className="card-title">Subscriptions</span>
          <span className="card-sub">billed by the platform Stripe account</span>
        </div>
        <table className="itable">
          <thead>
            <tr>
              <th>Client</th>
              <th>Plan</th>
              <th>MRR</th>
              <th>Renews</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {filtered(fleet).map((inst) => (
              <tr key={inst.id}>
                <td>
                  <InstCell inst={inst} />
                </td>
                <td>{inst.license.plan}</td>
                <td>${inst.status === "Suspended" ? 0 : inst.license.priceMonthly}</td>
                <td>{inst.license.renewsAt}</td>
                <td>
                  {inst.status === "Suspended" ? (
                    <Pill tone="warning">Past due</Pill>
                  ) : (
                    <Pill tone="success">Paid</Pill>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------- hosts ----------

function HostsView({ fleet }: { fleet: FleetState }) {
  const [addOpen, setAddOpen] = useState(false);
  return (
    <>
      <div className="card">
        <div className="card-head baseline" style={{ marginBottom: 6 }}>
          <span className="card-title">Hosts</span>
          <span className="card-sub">{fleet.hosts.length} VPS in the fleet</span>
          <div className="card-head-spacer" />
          <button type="button" className="link-teal" onClick={() => setAddOpen(true)}>
            + Add host
          </button>
        </div>
        {fleet.hosts.map((host) => (
          <div key={host.name} style={{ padding: "12px 0", borderBottom: "1px solid var(--row-divider)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <span className="host-name" style={{ width: "auto" }}>
                {host.name}
              </span>
              <span className="card-sub">
                {host.region} · {host.instanceCount} instance{host.instanceCount === 1 ? "" : "s"}
              </span>
            </div>
            {(
              [
                ["CPU", host.cpuPct],
                ["Memory", host.memPct],
                ["Disk", host.diskPct],
              ] as const
            ).map(([label, pct]) => (
              <div key={label} className="meter-row">
                <span className="meter-name">{label}</span>
                <span className="bar" style={{ height: 8 }}>
                  <span
                    className="bar-fill"
                    style={{
                      width: `${pct}%`,
                      height: 8,
                      background: pct >= 80 ? "var(--warning)" : "var(--success)",
                    }}
                  />
                </span>
                <span className="meter-pct">{pct}%</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      {addOpen && <AddHostModal onClose={() => setAddOpen(false)} />}
    </>
  );
}

// ---------- alerts ----------

function AlertsView({ fleet }: { fleet: FleetState }) {
  const open = fleet.alerts.filter((a) => !a.resolved);
  const resolved = fleet.alerts.filter((a) => a.resolved);
  return (
    <div className="card">
      <div className="card-head" style={{ marginBottom: 12 }}>
        <span className="card-title">Alerts</span>
        <span className="card-sub">
          {open.length} open · {resolved.length} resolved
        </span>
      </div>
      {open.map((alert) => (
        <div key={alert.id} className={`alert-row alert-${alert.severity}`}>
          <span className={`alert-bar ${alert.severity}`} />
          <span className="alert-body">
            <span className="alert-title">{alert.title}</span>
            <span className="alert-meta">{alert.meta}</span>
          </span>
          <button type="button" className="chip-action" onClick={() => resolveAlert(alert.id)}>
            {alert.action}
          </button>
        </div>
      ))}
      {open.length === 0 && <div className="empty-note">No open alerts — the fleet is quiet.</div>}
      {resolved.map((alert) => (
        <div key={alert.id} className="alert-row alert-resolved">
          <span className="alert-bar resolved" />
          <span className="alert-body">
            <span className="alert-title">{alert.title}</span>
            <span className="alert-meta">{alert.meta}</span>
          </span>
          <Pill tone="neutral">Resolved</Pill>
        </div>
      ))}
    </div>
  );
}

// ---------- audit ----------

function AuditView({ fleet }: { fleet: FleetState }) {
  return (
    <div className="card">
      <div className="card-head" style={{ marginBottom: 6 }}>
        <span className="card-title">Audit log</span>
        <span className="card-sub">every operator + client action on the fleet</span>
      </div>
      {fleet.activity.map((entry) => (
        <div key={entry.id} className="act-row">
          {entry.avatarSeed === "fleet-bot" ? (
            <span className="act-avatar-tile">
              <Icon name="server" size={13} />
            </span>
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={`https://picsum.photos/seed/${entry.avatarSeed}/200/200`} alt="" className="act-avatar" />
          )}
          <span className="act-text">
            <b>{entry.actor}</b> — {entry.prefix}
            <b>{entry.target}</b>
            {entry.suffix}
          </span>
          <span className="act-time">{entry.ago}</span>
        </div>
      ))}
    </div>
  );
}

// ---------- settings ----------

function SettingsView({ fleet }: { fleet: FleetState }) {
  const [backupWindow, setBackupWindow] = useState(fleet.settings.backupWindow);
  const [canarySize, setCanarySize] = useState(String(fleet.settings.canarySize));
  const [portBase, setPortBase] = useState(String(fleet.settings.portRangeBase));
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <div className="grid-main-rail">
      <div className="card">
        <div className="card-title" style={{ marginBottom: 12 }}>
          Fleet settings
        </div>
        <div className="modal-body" style={{ maxWidth: 460 }}>
          <label className="field">
            <span className="field-label">Backup window</span>
            <input className="input mono" value={backupWindow} onChange={(e) => setBackupWindow(e.target.value)} />
            <span className="field-hint">Nightly pg_dump + uploads snapshot, per instance.</span>
          </label>
          <label className="field">
            <span className="field-label">Canary size</span>
            <input className="input mono" value={canarySize} onChange={(e) => setCanarySize(e.target.value)} />
            <span className="field-hint">Instances updated first in every rollout, with a 24h soak.</span>
          </label>
          <label className="field">
            <span className="field-label">Port range base</span>
            <input className="input mono" value={portBase} onChange={(e) => setPortBase(e.target.value)} />
            <span className="field-hint">Each instance gets three host ports (API/WEB/ADMIN) above this.</span>
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await updateSettings({
                  backupWindow,
                  canarySize: Number(canarySize) || fleet.settings.canarySize,
                  portRangeBase: Number(portBase) || fleet.settings.portRangeBase,
                });
                setBusy(false);
                setSaved(true);
                setTimeout(() => setSaved(false), 2000);
              }}
            >
              {busy ? "Saving…" : "Save settings"}
            </button>
            {saved && <span className="saved-flash">Saved ✓</span>}
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-title" style={{ marginBottom: 12 }}>
          Image set
        </div>
        <p className="modal-note" style={{ marginBottom: 12 }}>
          Built once by <span className="mono">deploy/instance/build-images.sh</span>; every instance runs
          these images with its own env — no per-client rebuild.
        </p>
        <div className="kv-grid" style={{ gridTemplateColumns: "1fr" }}>
          <div className="kv">
            <span className="kv-k">API image</span>
            <span className="kv-v mono">{fleet.settings.apiImage}</span>
          </div>
          <div className="kv">
            <span className="kv-k">Web image</span>
            <span className="kv-v mono">{fleet.settings.webImage}</span>
          </div>
          <div className="kv">
            <span className="kv-k">Admin image</span>
            <span className="kv-v mono">{fleet.settings.adminImage}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
