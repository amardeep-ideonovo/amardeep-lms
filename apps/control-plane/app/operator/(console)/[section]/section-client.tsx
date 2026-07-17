"use client";

// Operator sidebar sections — small live views over the same fleet store so
// no nav item is dead: provisioning, updates, backups, plans, licenses,
// clients, billing, hosts, alerts, audit, settings.

import Link from "next/link";
import { notFound } from "next/navigation";
import { useState } from "react";
import { AddHostModal } from "@/components/AddHostModal";
import {
  CapOverrideModal,
  ChangeLicensePlanModal,
  PlanEditorModal,
  ProvisionForClientModal,
  TrackOverrideModal,
} from "@/components/operator-modals";
import { RolloutCard } from "@/components/RolloutCard";
import { Icon } from "@/components/icons";
import { Avatar, ConfirmModal, Kebab, PageSkeleton, Pill } from "@/components/ui";
import {
  clientInstances,
  clientsOnPlan,
  displayStatus,
  effectiveCap,
  effectiveTrack,
  getPlan,
  initialsOf,
  planName,
  reorderPlan,
  resolveAlert,
  resumeLicense,
  sortedPlans,
  suspendLicense,
  togglePlanActive,
  trackLabel,
  updateSettings,
} from "@/lib/provisioner";
import { useFleet } from "@/lib/useFleet";
import type { AppTrack, ClientAccount, FleetState, Instance, Plan } from "@/lib/types";
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
      {section === "plans" && <PlansView fleet={fleet} />}
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

function ClientCell({ client }: { client: ClientAccount }) {
  return (
    <span className="inst-cell">
      <span className="inst-tile">{initialsOf(client.academyName)}</span>
      <span className="inst-text">
        <span className="inst-name">{client.academyName}</span>
        <span className="inst-domain">{client.email}</span>
      </span>
    </span>
  );
}

function trackTone(track: AppTrack): "neutral" | "info" | "success" {
  if (track === "shared") return "info";
  if (track === "whitelabel") return "success";
  return "neutral";
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

/** Topbar-search filter for the client/license views. */
function filteredClients(fleet: FleetState): ClientAccount[] {
  const q = fleet.ui.instanceQuery.trim().toLowerCase();
  if (!q) return fleet.clients;
  return fleet.clients.filter(
    (c) =>
      c.academyName.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      planName(fleet, c.license.planId).toLowerCase().includes(q) ||
      clientInstances(fleet, c.id).some((i) => i.id.includes(q) || i.domain.toLowerCase().includes(q))
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
                    ) : inst.status === "Suspended" || inst.status === "Stopped" ? (
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

// ---------- plans (operator-defined catalog) ----------

function PlansView({ fleet }: { fleet: FleetState }) {
  const [editor, setEditor] = useState<{ open: boolean; plan: Plan | null }>({
    open: false,
    plan: null,
  });
  const [deactivateTarget, setDeactivateTarget] = useState<Plan | null>(null);
  const plans = sortedPlans(fleet);

  return (
    <>
      <div className="card">
        <div className="card-head baseline" style={{ marginBottom: 6 }}>
          <span className="card-title">Plan catalog</span>
          <span className="card-sub">
            drives the sales page, signup, portal billing and every license
          </span>
          <div className="card-head-spacer" />
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setEditor({ open: true, plan: null })}
          >
            + New plan
          </button>
        </div>
        <table className="itable">
          <colgroup>
            <col style={{ width: "6%" }} />
            <col style={{ width: "28%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "9%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>Order</th>
              <th>Plan</th>
              <th>Price</th>
              <th>Instance cap</th>
              <th>App track</th>
              <th>Clients</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {plans.map((plan, idx) => {
              const clients = clientsOnPlan(fleet, plan.id);
              return (
                <tr key={plan.id} style={plan.active ? undefined : { opacity: 0.6 }}>
                  <td>
                    <span className="order-btns">
                      <button
                        type="button"
                        className="order-btn"
                        aria-label={`Move ${plan.name} up`}
                        disabled={idx === 0}
                        onClick={() => reorderPlan(plan.id, -1)}
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        className="order-btn"
                        aria-label={`Move ${plan.name} down`}
                        disabled={idx === plans.length - 1}
                        onClick={() => reorderPlan(plan.id, 1)}
                      >
                        ▼
                      </button>
                    </span>
                  </td>
                  <td>
                    <span className="inst-cell">
                      <span className="inst-text">
                        <span className="inst-name">
                          {plan.name}
                          {plan.featured ? " ★" : ""}
                        </span>
                        <span className="inst-domain">{plan.blurb || "—"}</span>
                      </span>
                    </span>
                  </td>
                  <td>${plan.priceMonthly}/mo</td>
                  <td>
                    {plan.instanceCap} instance{plan.instanceCap === 1 ? "" : "s"}
                  </td>
                  <td>
                    <Pill tone={trackTone(plan.appTrack)}>{trackLabel(plan.appTrack)}</Pill>
                  </td>
                  <td>{clients}</td>
                  <td>
                    {plan.active ? <Pill tone="success">Active</Pill> : <Pill tone="neutral">Off sale</Pill>}
                  </td>
                  <td style={{ textAlign: "right", overflow: "visible" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <button
                        type="button"
                        className="chip-action"
                        onClick={() => setEditor({ open: true, plan })}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="chip-action"
                        onClick={() => {
                          if (plan.active) setDeactivateTarget(plan);
                          else togglePlanActive(plan.id);
                        }}
                      >
                        {plan.active ? "Deactivate" : "Activate"}
                      </button>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="card">
        <div className="card-title" style={{ marginBottom: 8 }}>
          How the catalog flows
        </div>
        {[
          "Active plans render on the sales page and the signup wizard in this order — features verbatim, featured plans get the ribbon.",
          "Every license points at a plan: price, instance cap and app track follow it live (per-license overrides win).",
          "Deactivating a plan hides it from sale — existing licenses keep it until you change their plan.",
          "Price edits reprice every active license on the plan and the fleet MRR immediately.",
        ].map((line, idx) => (
          <div key={line} className="boot-step">
            <span className="boot-num">{idx + 1}</span>
            {line}
          </div>
        ))}
      </div>

      {editor.open && (
        <PlanEditorModal plan={editor.plan} onClose={() => setEditor({ open: false, plan: null })} />
      )}
      {deactivateTarget && (
        <ConfirmModal
          title={`Deactivate ${deactivateTarget.name}?`}
          body={
            <>
              <div className="warn-box">
                {deactivateTarget.name} disappears from the sales page, signup and the portal upgrade
                dialog. Nothing changes for the {clientsOnPlan(fleet, deactivateTarget.id)} client
                {clientsOnPlan(fleet, deactivateTarget.id) === 1 ? "" : "s"} already on it.
              </div>
            </>
          }
          confirmLabel="Deactivate plan"
          onConfirm={() => togglePlanActive(deactivateTarget.id)}
          onClose={() => setDeactivateTarget(null)}
        />
      )}
    </>
  );
}

// ---------- licenses (full operator control) ----------

type LicenseDialog =
  | { kind: "plan"; client: ClientAccount }
  | { kind: "cap"; client: ClientAccount }
  | { kind: "track"; client: ClientAccount }
  | { kind: "suspend"; client: ClientAccount }
  | { kind: "resume"; client: ClientAccount }
  | { kind: "provision"; client: ClientAccount }
  | null;

function LicensesView({ fleet }: { fleet: FleetState }) {
  const [dialog, setDialog] = useState<LicenseDialog>(null);
  const clients = filteredClients(fleet);

  return (
    <>
      <div className="card">
        <div className="card-head" style={{ marginBottom: 6 }}>
          <span className="card-title">Licenses</span>
          <span className="card-sub">
            one per client — plan, cap and app track are yours to change
          </span>
        </div>
        <table className="itable">
          <colgroup>
            <col style={{ width: "27%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "5%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>Client</th>
              <th>Plan</th>
              <th>Price</th>
              <th>Instances</th>
              <th>App track</th>
              <th>Status</th>
              <th>Since</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {clients.map((client) => {
              const plan = getPlan(fleet, client.license.planId);
              const owned = clientInstances(fleet, client.id);
              const cap = effectiveCap(fleet, client.license);
              const track = effectiveTrack(fleet, client.license);
              const capOverridden = typeof client.license.instanceCapOverride === "number";
              const trackOverridden = client.license.appTrackOverride != null;
              const suspended = client.license.status === "suspended";
              const atCap = owned.length >= cap;
              return (
                <tr key={client.id}>
                  <td>
                    <ClientCell client={client} />
                  </td>
                  <td>{plan?.name ?? client.license.planId}</td>
                  <td>${plan?.priceMonthly ?? 0}/mo</td>
                  <td>
                    {owned.length} / {cap}
                    {capOverridden && <span className="override-mark"> · override</span>}
                  </td>
                  <td>
                    <Pill tone={trackTone(track)}>{trackLabel(track)}</Pill>
                    {trackOverridden && <span className="override-mark"> · override</span>}
                  </td>
                  <td>
                    {suspended ? <Pill tone="warning">Suspended</Pill> : <Pill tone="success">Active</Pill>}
                  </td>
                  <td>{client.createdAt}</td>
                  <td style={{ overflow: "visible", textAlign: "right" }}>
                    <Kebab
                      items={[
                        { label: "Change plan…", onSelect: () => setDialog({ kind: "plan", client }) },
                        {
                          label: "Override instance cap…",
                          onSelect: () => setDialog({ kind: "cap", client }),
                        },
                        {
                          label: "Switch app track…",
                          onSelect: () => setDialog({ kind: "track", client }),
                        },
                        {
                          label: atCap
                            ? `Provision instance (at cap ${owned.length}/${cap})`
                            : "Provision instance for client…",
                          disabled: atCap || suspended,
                          onSelect: () => setDialog({ kind: "provision", client }),
                        },
                        suspended
                          ? { label: "Resume license", onSelect: () => setDialog({ kind: "resume", client }) }
                          : {
                              label: "Suspend license",
                              danger: true,
                              onSelect: () => setDialog({ kind: "suspend", client }),
                            },
                      ]}
                    />
                  </td>
                </tr>
              );
            })}
            {clients.length === 0 && (
              <tr>
                <td colSpan={8}>
                  <span className="empty-note">No licenses match — clear the search.</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {dialog?.kind === "plan" && (
        <ChangeLicensePlanModal fleet={fleet} client={dialog.client} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "cap" && (
        <CapOverrideModal fleet={fleet} client={dialog.client} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "track" && (
        <TrackOverrideModal fleet={fleet} client={dialog.client} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "provision" && (
        <ProvisionForClientModal fleet={fleet} client={dialog.client} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "suspend" && (
        <ConfirmModal
          title={`Suspend ${dialog.client.academyName}'s license?`}
          tone="danger"
          body={
            <>
              <div className="warn-box">
                The portal shows a “License suspended” banner and every mutating action is disabled.
                Their {clientInstances(fleet, dialog.client.id).length} instance
                {clientInstances(fleet, dialog.client.id).length === 1 ? " keeps" : "s keep"} running —
                members are not interrupted.
              </div>
              <p className="modal-note">
                MRR drops by ${getPlan(fleet, dialog.client.license.planId)?.priceMonthly ?? 0}/mo until
                you resume.
              </p>
            </>
          }
          confirmLabel="Suspend license"
          onConfirm={() => suspendLicense(dialog.client.id)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "resume" && (
        <ConfirmModal
          title={`Resume ${dialog.client.academyName}'s license?`}
          body={
            <p className="modal-note">
              Billing restarts at ${getPlan(fleet, dialog.client.license.planId)?.priceMonthly ?? 0}/mo,
              the portal banner clears, and any parked instances come back up.
            </p>
          }
          confirmLabel="Resume license"
          onConfirm={() => resumeLicense(dialog.client.id)}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

// ---------- clients ----------

function ClientsView({ fleet }: { fleet: FleetState }) {
  const clients = filteredClients(fleet);
  return (
    <div className="card">
      <div className="card-head" style={{ marginBottom: 6 }}>
        <span className="card-title">Clients</span>
        <span className="card-sub">{fleet.clients.length} license holders</span>
      </div>
      <table className="itable">
        <colgroup>
          <col style={{ width: "26%" }} />
          <col style={{ width: "13%" }} />
          <col style={{ width: "27%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "12%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>Client</th>
            <th>Owner</th>
            <th>Instances</th>
            <th>Members</th>
            <th>Open tickets</th>
            <th>License</th>
          </tr>
        </thead>
        <tbody>
          {clients.map((client) => {
            const owned = clientInstances(fleet, client.id);
            const cap = effectiveCap(fleet, client.license);
            const members = owned.reduce((sum, i) => sum + (i.membersCount ?? 0), 0);
            const openTickets = owned.flatMap((i) => i.tickets).filter((t) => t.status === "Open").length;
            return (
              <tr key={client.id}>
                <td>
                  <ClientCell client={client} />
                </td>
                <td>{client.name}</td>
                <td>
                  {owned.length === 0 ? (
                    <span className="empty-note" style={{ padding: 0 }}>
                      none yet · 0 of {cap}
                    </span>
                  ) : (
                    owned.map((inst) => {
                      const status = displayStatus(inst);
                      return (
                        <span key={inst.id} className="chip-inst" title={inst.domain}>
                          <span className={`chip-dot tone-${status.tone}`} />
                          {inst.id}
                        </span>
                      );
                    })
                  )}
                </td>
                <td>{members === 0 && owned.every((i) => i.membersCount === null) ? "—" : members.toLocaleString("en-US")}</td>
                <td>
                  {openTickets > 0 ? (
                    <Pill tone="danger">{openTickets} open</Pill>
                  ) : (
                    <Pill tone="neutral">none</Pill>
                  )}
                </td>
                <td>
                  <Link href="/operator/licenses" className="link-teal">
                    {planName(fleet, client.license.planId)} →
                  </Link>
                </td>
              </tr>
            );
          })}
          {clients.length === 0 && (
            <tr>
              <td colSpan={6}>
                <span className="empty-note">No clients match — clear the search.</span>
              </td>
            </tr>
          )}
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
          <span className="card-sub">billed by the platform Stripe account · one per license</span>
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
            {filteredClients(fleet).map((client) => {
              const suspended = client.license.status === "suspended";
              const price = getPlan(fleet, client.license.planId)?.priceMonthly ?? 0;
              return (
                <tr key={client.id}>
                  <td>
                    <ClientCell client={client} />
                  </td>
                  <td>{planName(fleet, client.license.planId)}</td>
                  <td>${suspended ? 0 : price}</td>
                  <td>{client.license.renewsAt}</td>
                  <td>{suspended ? <Pill tone="warning">Past due</Pill> : <Pill tone="success">Paid</Pill>}</td>
                </tr>
              );
            })}
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
            <Avatar name={entry.actor} seed={entry.avatarSeed} />
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
