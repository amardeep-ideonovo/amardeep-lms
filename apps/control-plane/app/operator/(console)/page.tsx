"use client";

// Operator dashboard — transcribed from frame 1a: fleet stat cards,
// all-instances table, rollout card, alerts queue, host capacity, activity
// feed. The support inbox card is reused from the earlier ops-console
// iteration and slots into the activity area.

import { useMemo, useState } from "react";
import { AddHostModal } from "@/components/AddHostModal";
import { RolloutCard } from "@/components/RolloutCard";
import { Icon } from "@/components/icons";
import { Avatar, ConfirmModal, HealthLabel, Kebab, PageSkeleton, Pill } from "@/components/ui";
import {
  activeWaveName,
  awaitingUpdateCount,
  clientForInstance,
  criticalAlertCount,
  destroyInstance,
  displayStatus,
  hostWorstMetric,
  initialsOf,
  openAlertCount,
  planName,
  resolveAlert,
  resumeLicense,
  startInstance,
  stopInstance,
  suspendLicense,
} from "@/lib/provisioner";
import { useFleet } from "@/lib/useFleet";
import type { FleetAlert, Instance } from "@/lib/types";

type RowFilter = "all" | "running" | "attention" | "provisioning" | "suspended";

const FILTER_LABELS: Record<RowFilter, string> = {
  all: "All",
  running: "Running",
  attention: "Needs attention",
  provisioning: "Provisioning",
  suspended: "Suspended",
};

function matchesFilter(inst: Instance, filter: RowFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "running":
      return inst.status === "Running";
    case "attention":
      return inst.health.tone === "warn" || inst.health.tone === "danger" || inst.updateQueued;
    case "provisioning":
      return inst.status === "Provisioning";
    case "suspended":
      return inst.status === "Suspended" || inst.status === "Stopped";
  }
}

export default function OperatorDashboard() {
  const fleet = useFleet();
  const [filter, setFilter] = useState<RowFilter>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [destroyTarget, setDestroyTarget] = useState<Instance | null>(null);

  const query = fleet?.ui.instanceQuery.trim().toLowerCase() ?? "";
  const rows = useMemo(() => {
    if (!fleet) return [];
    return fleet.instances.filter(
      (i) =>
        matchesFilter(i, filter) &&
        (query === "" ||
          i.clientName.toLowerCase().includes(query) ||
          i.domain.toLowerCase().includes(query) ||
          i.id.includes(query) ||
          i.owner.toLowerCase().includes(query))
    );
  }, [fleet, filter, query]);

  if (!fleet) return <PageSkeleton />;

  const openAlerts = fleet.alerts.filter((a) => !a.resolved);
  const runningCount = fleet.stats.running;
  const awaiting = awaitingUpdateCount(fleet);
  const criticals = criticalAlertCount(fleet);
  const openTickets = fleet.instances.flatMap((i) => i.tickets).filter((t) => t.status === "Open");
  const inboxRows = fleet.instances
    .flatMap((i) => i.tickets.map((t) => ({ ticket: t, instance: i })))
    .slice(0, 4);

  return (
    <div className="stack page-in">
      {/* ---- fleet stat cards ---- */}
      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-icon tint-success">
            <Icon name="package" size={17} />
          </span>
          <span>
            <span className="stat-label">Running instances</span>
            <span className="stat-value">{runningCount}</span>
            <span className="stat-note tone-success">of {fleet.stats.licenses} licenses</span>
          </span>
        </div>
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
          <span className="stat-icon tint-info">
            <Icon name="download" size={17} />
          </span>
          <span>
            <span className="stat-label">Awaiting {fleet.rollout.targetVersion}</span>
            <span className="stat-value">{awaiting}</span>
            <span className="stat-note tone-info">rollout {activeWaveName(fleet)}</span>
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-icon tint-danger">
            <Icon name="alert-triangle" size={17} />
          </span>
          <span>
            <span className="stat-label">Open alerts</span>
            <span className="stat-value">{openAlertCount(fleet)}</span>
            <span className="stat-note tone-danger">
              {criticals > 0 ? `${criticals} critical` : "none critical"}
            </span>
          </span>
        </div>
      </div>

      {/* ---- table + rollout/alerts rail ---- */}
      <div className="grid-main-rail">
        <div className="card">
          <div className="card-head" style={{ marginBottom: 6 }}>
            <span className="card-title">All instances</span>
            <span className="card-sub">
              {fleet.stats.licenses} licenses · {runningCount} running
            </span>
            <div className="card-head-spacer" />
            <span className="kebab-wrap">
              <button type="button" className="link-teal" onClick={() => setFilterOpen((v) => !v)}>
                {filter === "all" ? "Filter" : FILTER_LABELS[filter]} ▾
              </button>
              {filterOpen && (
                <button
                  type="button"
                  className="pop-backdrop"
                  aria-label="Close filter menu"
                  onClick={() => setFilterOpen(false)}
                />
              )}
              {filterOpen && (
                <div className="pop-menu pop-right" role="menu">
                  {(Object.keys(FILTER_LABELS) as RowFilter[]).map((f) => (
                    <button
                      key={f}
                      type="button"
                      role="menuitem"
                      className="pop-item"
                      style={f === filter ? { color: "var(--teal-text)", fontWeight: 600 } : undefined}
                      onClick={() => {
                        setFilter(f);
                        setFilterOpen(false);
                      }}
                    >
                      {FILTER_LABELS[f]}
                    </button>
                  ))}
                </div>
              )}
            </span>
          </div>
          <table className="itable">
            <colgroup>
              <col style={{ width: "32.8%" }} />
              <col style={{ width: "10.2%" }} />
              <col style={{ width: "14.8%" }} />
              <col style={{ width: "10.9%" }} />
              <col style={{ width: "10.9%" }} />
              <col style={{ width: "15.6%" }} />
              <col style={{ width: "4.8%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>Instance</th>
                <th>Version</th>
                <th>Health</th>
                <th>Members</th>
                <th>Plan</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((inst) => {
                const status = displayStatus(inst);
                const owner = clientForInstance(fleet, inst);
                const licenseSuspended = owner?.license.status === "suspended";
                return (
                  <tr key={inst.id}>
                    <td>
                      <span className="inst-cell">
                        <span className="inst-tile">{initialsOf(inst.clientName)}</span>
                        <span className="inst-text">
                          <span className="inst-name">{inst.clientName}</span>
                          <span className="inst-domain">{inst.domain}</span>
                        </span>
                      </span>
                    </td>
                    <td className="cell-version">{inst.version}</td>
                    <td>
                      <HealthLabel tone={inst.health.tone} label={inst.health.label} />
                    </td>
                    <td>{inst.membersCount === null ? "—" : inst.membersCount.toLocaleString("en-US")}</td>
                    <td>{owner ? planName(fleet, owner.license.planId) : "—"}</td>
                    <td>
                      <Pill tone={status.tone}>{status.label}</Pill>
                    </td>
                    <td style={{ overflow: "visible" }}>
                      <Kebab
                        items={[
                          { label: "Open admin", href: inst.urls.admin },
                          { label: "Member site", href: inst.urls.web },
                          ...(inst.status === "Running"
                            ? [{ label: "Stop (compose stop)", onSelect: () => stopInstance(inst.id) }]
                            : inst.status === "Stopped" ||
                                (inst.status === "Suspended" && !licenseSuspended)
                              ? [{ label: "Start (compose start)", onSelect: () => startInstance(inst.id) }]
                              : inst.status === "Provisioning"
                                ? [{ label: "Booting…", disabled: true }]
                                : []),
                          ...(owner
                            ? [
                                licenseSuspended
                                  ? {
                                      label: "Resume license",
                                      onSelect: () => resumeLicense(owner.id),
                                    }
                                  : {
                                      label: "Suspend license",
                                      onSelect: () => suspendLicense(owner.id),
                                    },
                              ]
                            : []),
                          { label: "Destroy…", danger: true, onSelect: () => setDestroyTarget(inst) },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <span className="empty-note">No instances match — clear the search or filter.</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="col">
          <RolloutCard rollout={fleet.rollout} />
          <div className="card">
            <div className="card-title" style={{ marginBottom: 12 }}>
              Alerts
            </div>
            {openAlerts.map((alert) => (
              <AlertRow key={alert.id} alert={alert} />
            ))}
            {openAlerts.length === 0 && (
              <div className="empty-note">No open alerts — the fleet is quiet.</div>
            )}
          </div>
        </div>
      </div>

      {/* ---- hosts + support inbox | activity ---- */}
      <div className="grid-main-rail">
        <div className="col">
          <div className="card">
            <div className="card-head baseline" style={{ marginBottom: 6 }}>
              <span className="card-title">Host capacity</span>
              <div className="card-head-spacer" />
              <AddHostLink />
            </div>
            {fleet.hosts.map((host) => {
              const worst = hostWorstMetric(host);
              return (
                <div key={host.name} className="host-row">
                  <span className="host-name">{host.name}</span>
                  <span className="host-count">
                    {host.instanceCount} instance{host.instanceCount === 1 ? "" : "s"}
                  </span>
                  <span className="bar" style={{ height: 8 }}>
                    <span
                      className="bar-fill"
                      style={{
                        width: `${worst.pct}%`,
                        height: 8,
                        background: worst.pct >= 80 ? "var(--warning)" : "var(--success)",
                      }}
                    />
                  </span>
                  <span className="host-metric">
                    {worst.pct}% {worst.label}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Support inbox — reused ops widget (earlier dashboard iteration) */}
          <div className="card">
            <div className="card-head baseline" style={{ marginBottom: 8 }}>
              <span className="card-title">Support inbox</span>
              <div className="card-head-spacer" />
              <span className="link-teal">Open inbox · {openTickets.length}</span>
            </div>
            {inboxRows.map(({ ticket, instance }) => (
              <div key={ticket.id} className="inbox-row">
                <span className="inst-tile" style={{ width: 30, height: 30, fontSize: 11 }}>
                  {initialsOf(instance.clientName)}
                </span>
                <span className="inbox-body">
                  <span className="inbox-subject">{ticket.subject}</span>
                  <span className="inbox-meta">
                    {ticket.requester} · {instance.clientName}
                  </span>
                </span>
                <Pill tone={ticket.status === "Open" ? "danger" : "success"}>{ticket.status}</Pill>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-title" style={{ marginBottom: 6 }}>
            Operator activity
          </div>
          {fleet.activity.slice(0, 6).map((entry) => (
            <div key={entry.id} className="act-row">
              {entry.avatarSeed === "fleet-bot" ? (
                <span className="act-avatar-tile">
                  <Icon name="server" size={13} />
                </span>
              ) : (
                <Avatar name={entry.actor} seed={entry.avatarSeed} />
              )}
              <span className="act-text">
                {entry.prefix}
                <b>{entry.target}</b>
                {entry.suffix}
              </span>
              <span className="act-time">{entry.ago}</span>
            </div>
          ))}
        </div>
      </div>

      {destroyTarget && (
        <ConfirmModal
          title={`Destroy ${destroyTarget.clientName}?`}
          tone="danger"
          body={
            <>
              <div className="danger-box">
                Runs <span className="mono">docker compose -p {destroyTarget.dbName} down -v</span> — containers
                AND data volumes (Postgres, Redis, uploads) are deleted. This cannot be undone.
              </div>
              <p className="modal-note">
                Last backup: {destroyTarget.backups.lastRunAt} ({destroyTarget.backups.schedule}).
              </p>
            </>
          }
          confirmLabel="Destroy instance"
          onConfirm={() => destroyInstance(destroyTarget.id)}
          onClose={() => setDestroyTarget(null)}
        />
      )}
    </div>
  );
}

function AlertRow({ alert }: { alert: FleetAlert }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className={`alert-row alert-${alert.severity}`}>
      <span className={`alert-bar ${alert.severity}`} />
      <span className="alert-body">
        <span className="alert-title">{alert.title}</span>
        <span className="alert-meta">{alert.meta}</span>
      </span>
      <button
        type="button"
        className="chip-action"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await resolveAlert(alert.id);
        }}
      >
        {busy ? "…" : alert.action}
      </button>
    </div>
  );
}

function AddHostLink() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="link-teal" onClick={() => setOpen(true)}>
        + Add host
      </button>
      {open && <AddHostModal onClose={() => setOpen(false)} />}
    </>
  );
}
