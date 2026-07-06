"use client";

// Portal sidebar sections — live views over the signed-in client's OWN
// instances in the mock store (the demo session binds to Harbor Yoga):
// my instances, backups, mobile apps, billing, support. Instance-scoped
// sections operate on the SELECTED instance (shared, persisted switcher);
// billing is license-scoped and covers every instance.

import Link from "next/link";
import { notFound } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icons";
import { InstanceSwitcher } from "@/components/instance-switcher";
import {
  handleDownloadBackup,
  ManageBillingModal,
  NewTicketModal,
  RequestBuildModal,
  RestoreModal,
  UpgradeModal,
} from "@/components/portal-modals";
import { PageSkeleton, Pill } from "@/components/ui";
import { useClientSession } from "@/lib/auth";
import { useSelectedInstance } from "@/lib/instance-selection";
import {
  clientInstances,
  displayStatus,
  effectiveCap,
  effectiveTrack,
  getPlan,
  initialsOf,
  licenseSummary,
  portalClient,
  uptimeLabel,
} from "@/lib/provisioner";
import { useFleet } from "@/lib/useFleet";
import type { AppTrack, ClientAccount, FleetState, Instance, MobileBuild } from "@/lib/types";
import { SECTIONS, type Section } from "./sections";

export default function PortalSection({ section: sectionParam }: { section: string }) {
  const session = useClientSession();
  const fleet = useFleet();
  if (!SECTIONS.includes(sectionParam as Section)) notFound();

  const client = fleet ? portalClient(fleet, session) : undefined;
  const owned = fleet && client ? clientInstances(fleet, client.id) : [];
  const [selected, setSelected] = useSelectedInstance(owned);
  if (!fleet || !session || !client) return <PageSkeleton />;

  const suspended = client.license.status === "suspended";
  const section = sectionParam as Section;

  if (owned.length === 0 || !selected) {
    const plan = getPlan(fleet, client.license.planId);
    return (
      <div className="stack page-in">
        <div className="card onboard-card">
          <div className="card-head" style={{ marginBottom: 6 }}>
            <span className="card-title">No instance yet</span>
          </div>
          <p className="modal-note" style={{ marginBottom: 14, maxWidth: 460 }}>
            Your {plan?.name ?? "current"} license is active, but {client.academyName} hasn't been
            provisioned yet. Launch it from the overview — everything here lights up the moment it
            boots.
          </p>
          <Link href="/portal" className="btn btn-primary" style={{ alignSelf: "flex-start" }}>
            Launch {client.academyName}
          </Link>
        </div>
      </div>
    );
  }

  // Billing is license-wide; every other section is scoped to the selection.
  const showSwitcher = owned.length > 1 && section !== "billing";

  return (
    <div className="stack page-in">
      {showSwitcher && (
        <InstanceSwitcher instances={owned} selectedId={selected.id} onSelect={setSelected} />
      )}
      {section === "instance" && <InstanceView instance={selected} />}
      {section === "backups" && <BackupsView instance={selected} suspended={suspended} />}
      {section === "mobile" && (
        <MobileView fleet={fleet} client={client} instance={selected} suspended={suspended} />
      )}
      {section === "billing" && (
        <BillingView fleet={fleet} client={client} owned={owned} suspended={suspended} />
      )}
      {section === "support" && (
        <SupportView fleet={fleet} client={client} instance={selected} suspended={suspended} />
      )}
    </div>
  );
}

// ---------- my instance(s) ----------

function InstanceView({ instance }: { instance: Instance }) {
  const status = displayStatus(instance);
  const services: Array<[string, string]> = [
    ["API", instance.health.api],
    ["Web", instance.health.web],
    ["Admin", instance.health.admin],
    ["Database", instance.health.db],
    ["Queue", instance.health.db],
  ];
  return (
    <>
      <div className="hero-card">
        <span className="hero-tile">{initialsOf(instance.clientName)}</span>
        <span className="hero-body">
          <span className="hero-title-row">
            <span className="hero-name">{instance.clientName}</span>
            <Pill tone={status.tone}>● {status.label}</Pill>
          </span>
          <span className="hero-meta">
            {instance.domain} · {instance.dbName} · {instance.version} · {uptimeLabel(instance)}
          </span>
        </span>
        <span className="hero-actions">
          <a href={instance.urls.admin} target="_blank" rel="noreferrer" className="btn btn-primary">
            Open admin
          </a>
          <a href={instance.urls.web} target="_blank" rel="noreferrer" className="btn btn-ghost">
            <Icon name="external-link" size={13} />
            Member site
          </a>
        </span>
      </div>

      <div className="grid-main-rail">
        <div className="card">
          <div className="card-head" style={{ marginBottom: 4 }}>
            <span className="card-title">Deployment</span>
            <span className="card-sub">one fully isolated stack — nothing shared</span>
          </div>
          <div className="kv-grid">
            <div className="kv">
              <span className="kv-k">Instance id</span>
              <span className="kv-v mono">{instance.id}</span>
            </div>
            <div className="kv">
              <span className="kv-k">Compose project</span>
              <span className="kv-v mono">{instance.dbName}</span>
            </div>
            <div className="kv">
              <span className="kv-k">Version</span>
              <span className="kv-v mono">{instance.version}</span>
            </div>
            <div className="kv">
              <span className="kv-k">API port</span>
              <span className="kv-v mono">{instance.ports.api}</span>
            </div>
            <div className="kv">
              <span className="kv-k">Web port</span>
              <span className="kv-v mono">{instance.ports.web}</span>
            </div>
            <div className="kv">
              <span className="kv-k">Admin port</span>
              <span className="kv-v mono">{instance.ports.admin}</span>
            </div>
            <div className="kv">
              <span className="kv-k">Host</span>
              <span className="kv-v mono">
                {instance.metrics ? `${instance.metrics.host} · ${instance.metrics.region}` : "—"}
              </span>
            </div>
            <div className="kv">
              <span className="kv-k">Created</span>
              <span className="kv-v">{instance.createdAt}</span>
            </div>
            <div className="kv">
              <span className="kv-k">Volumes</span>
              <span className="kv-v mono">pg · redis · uploads</span>
            </div>
          </div>
          <p className="modal-note" style={{ marginTop: 16 }}>
            Your database, media, and job queue run in containers namespaced{" "}
            <span className="mono">{instance.dbName}</span>. Stripe, email, and video keys live in your own
            admin Settings, encrypted with your instance's key.
          </p>
        </div>

        <div className="card">
          <div className="card-title" style={{ marginBottom: 8 }}>
            Services
          </div>
          {services.map(([name, state]) => (
            <div key={name} className="brow">
              <span className="brow-body">
                <span className="brow-title">{name}</span>
              </span>
              {state === "ok" ? (
                <Pill tone="success">Operational</Pill>
              ) : state === "warn" ? (
                <Pill tone="warning">Degraded</Pill>
              ) : (
                <Pill tone="neutral">—</Pill>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ---------- backups ----------

function BackupsView({ instance, suspended }: { instance: Instance; suspended: boolean }) {
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  return (
    <>
      <div className="card">
        <div className="card-head" style={{ marginBottom: 6 }}>
          <span className="card-title">Backups</span>
          <span className="card-sub">{instance.backups.retentionNote}</span>
          <div className="card-head-spacer" />
          <Pill tone="neutral">{instance.backups.schedule}</Pill>
        </div>
        {instance.restoreInProgress && (
          <div className="info-banner" style={{ marginTop: 4, marginBottom: 8 }}>
            Restoring “{instance.restoreInProgress.entryLabel}” — maintenance mode is on for members.
          </div>
        )}
        <table className="itable">
          <thead>
            <tr>
              <th>Snapshot</th>
              <th>Contents</th>
              <th>Size</th>
              <th>Verified</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {instance.backups.entries.map((entry) => (
              <tr key={entry.id}>
                <td>
                  <span className="inst-name">{entry.label}</span>
                </td>
                <td>{entry.detail}</td>
                <td>{(entry.sizeMb / 1024).toFixed(1)} GB</td>
                <td>
                  {entry.verified ? <Pill tone="success">Verified</Pill> : <Pill tone="warning">Pending</Pill>}
                </td>
                <td style={{ textAlign: "right" }}>
                  <button
                    type="button"
                    className="chip-action"
                    disabled={downloadingId === entry.id}
                    onClick={async () => {
                      setDownloadingId(entry.id);
                      await handleDownloadBackup(instance.id, entry.id);
                      setDownloadingId(null);
                    }}
                  >
                    {downloadingId === entry.id ? "…" : "Download"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {instance.backups.entries.length === 0 && (
          <div className="empty-note">
            No snapshots yet — {instance.backups.retentionNote.toLowerCase()}. Every run is verified
            and mirrored off-server.
          </div>
        )}
        <div className="card-btn-row" style={{ maxWidth: 360 }}>
          <button
            type="button"
            className="btn-line"
            disabled={!!instance.restoreInProgress || instance.backups.entries.length === 0 || suspended}
            onClick={() => setRestoreOpen(true)}
          >
            Restore…
          </button>
        </div>
      </div>
      {restoreOpen && <RestoreModal instance={instance} onClose={() => setRestoreOpen(false)} />}
    </>
  );
}

// ---------- mobile apps (varies by the license's effective app track) ----------

function buildTone(build: MobileBuild): "success" | "warning" | "info" | "neutral" {
  if (build.status === "Live") return "success";
  if (build.status === "In review") return "warning";
  if (build.status === "Building") return "info";
  return "neutral";
}

function MobileView({
  fleet,
  client,
  instance,
  suspended,
}: {
  fleet: FleetState;
  client: ClientAccount;
  instance: Instance;
  suspended: boolean;
}) {
  const track: AppTrack = effectiveTrack(fleet, client.license);
  const [buildOpen, setBuildOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const shortName = instance.clientName.replace(" School", "");

  if (track === "none") {
    return (
      <>
        <div className="card onboard-card">
          <div className="card-head" style={{ marginBottom: 6 }}>
            <span className="mrow-icon">
              <Icon name="smartphone" size={15} />
            </span>
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span className="card-title">Your plan is web-only</span>
              <span className="card-sub">no mobile apps on the current license</span>
            </span>
            <div className="card-head-spacer" />
            <Pill tone="neutral">Web only</Pill>
          </div>
          <p className="modal-note" style={{ margin: "8px 0 14px", maxWidth: 520 }}>
            Upgrade for mobile apps: the shared Spotlight app gets {shortName} onto members' phones
            with a connect code, and white-label plans ship branded builds to your own App Store and
            Google Play listings.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            style={{ alignSelf: "flex-start" }}
            disabled={suspended}
            onClick={() => setUpgradeOpen(true)}
          >
            Upgrade for mobile apps
          </button>
        </div>
        {upgradeOpen && (
          <UpgradeModal fleet={fleet} client={client} onClose={() => setUpgradeOpen(false)} />
        )}
      </>
    );
  }

  if (track === "shared") {
    return (
      <>
        <div className="card onboard-card">
          <div className="card-head" style={{ marginBottom: 6 }}>
            <span className="mrow-icon">
              <Icon name="smartphone" size={15} />
            </span>
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span className="card-title">Connect code — {instance.clientName}</span>
              <span className="card-sub">shared Spotlight app · App Store + Google Play</span>
            </span>
            <div className="card-head-spacer" />
            <Pill tone="info">Shared app</Pill>
          </div>
          <div className="connect-code">
            <span className="connect-code-text">{instance.id}</span>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                navigator.clipboard?.writeText(instance.id);
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              }}
            >
              {copied ? "Copied ✓" : "Copy code"}
            </button>
          </div>
          <p className="modal-note" style={{ marginTop: 12, maxWidth: 560 }}>
            Members install the shared Spotlight app and enter this code — your branding and content
            load automatically. No store accounts, reviews or builds to manage.
          </p>
          <p className="modal-note" style={{ marginTop: 8, color: "var(--text-faint)" }}>
            Prefer your own branded apps?{" "}
            <button
              type="button"
              className="link-teal"
              disabled={suspended}
              onClick={() => setUpgradeOpen(true)}
            >
              Upgrade to a white-label plan
            </button>
          </p>
        </div>
        {upgradeOpen && (
          <UpgradeModal fleet={fleet} client={client} onClose={() => setUpgradeOpen(false)} />
        )}
      </>
    );
  }

  return (
    <>
      <div className="grid-main-rail">
        {(
          [
            ["iOS", instance.mobileBuilds.ios, "App Store · client-owned developer account"],
            ["Android", instance.mobileBuilds.android, "Google Play · client-owned developer account"],
          ] as const
        ).map(([platform, build, storeNote]) => (
          <div key={platform} className="card">
            <div className="card-head" style={{ marginBottom: 10 }}>
              <span className="mrow-icon">
                <Icon name="smartphone" size={15} />
              </span>
              <span style={{ display: "flex", flexDirection: "column" }}>
                <span className="card-title">
                  {platform} — {shortName}
                </span>
                <span className="card-sub">{storeNote}</span>
              </span>
              <div className="card-head-spacer" />
              <Pill tone={buildTone(build)}>{build.status}</Pill>
            </div>
            <div className="kv-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <div className="kv">
                <span className="kv-k">Version</span>
                <span className="kv-v mono">{build.version}</span>
              </div>
              <div className="kv">
                <span className="kv-k">Detail</span>
                <span className="kv-v">{build.detail}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="card">
        <div className="card-head baseline">
          <span className="card-title">Ship a new build</span>
          <div className="card-head-spacer" />
          <button
            type="button"
            className="btn btn-primary"
            disabled={suspended}
            onClick={() => setBuildOpen(true)}
          >
            Request build
          </button>
        </div>
        <p className="modal-note" style={{ marginTop: 8, maxWidth: 640 }}>
          Builds run on the per-client EAS track: the binary is branded to {instance.clientName}, points at
          your instance's API, and is submitted to the stores under your accounts. The platform team
          handles signing, review notes, and rollout.
        </p>
      </div>
      {buildOpen && <RequestBuildModal instance={instance} onClose={() => setBuildOpen(false)} />}
    </>
  );
}

// ---------- billing (license-scoped — covers every instance) ----------

const HARBOR_INVOICES: Array<{ id: string; date: string; amount: string; status: "Paid" }> = [
  { id: "INV-0231", date: "Jun 12, 2026", amount: "$249.00", status: "Paid" },
  { id: "INV-0198", date: "May 12, 2026", amount: "$249.00", status: "Paid" },
  { id: "INV-0164", date: "Apr 12, 2026", amount: "$249.00", status: "Paid" },
];

/** Harbor keeps its seeded history; a fresh self-serve academy has just the signup charge. */
function invoicesFor(
  client: ClientAccount,
  price: number
): Array<{ id: string; date: string; amount: string; status: "Paid" }> {
  if (client.id === "harbor") return HARBOR_INVOICES;
  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return [
    {
      id: `INV-${client.id.slice(0, 6).toUpperCase()}-001`,
      date: today,
      amount: `$${price}.00`,
      status: "Paid",
    },
  ];
}

function BillingView({
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
  const [dialog, setDialog] = useState<"billing" | "upgrade" | null>(null);
  const plan = getPlan(fleet, client.license.planId);
  const cap = effectiveCap(fleet, client.license);
  return (
    <>
      <div className="grid-main-rail">
        <div className="card">
          <div className="card-head">
            <span className="card-title">License</span>
            <div className="card-head-spacer" />
            {suspended ? <Pill tone="warning">Suspended</Pill> : <Pill tone="success">Active</Pill>}
          </div>
          <div className="price-row">
            <span className="price-big">
              {plan?.name ?? client.license.planId} — ${plan?.priceMonthly ?? 0}
            </span>
            <span className="price-per">/month</span>
          </div>
          <div className="license-copy">
            {suspended ? "Suspended — contact support" : `Renews ${client.license.renewsAt}`} ·{" "}
            {client.license.cardBrand} •••• {client.license.cardLast4}
            <br />
            Includes {licenseSummary(fleet, client.license)} — covering {owned.length} of {cap} instance
            slot{cap === 1 ? "" : "s"}
          </div>
          <div className="card-btn-row" style={{ marginTop: 13, maxWidth: 360 }}>
            <button
              type="button"
              className="btn-line"
              disabled={suspended}
              onClick={() => setDialog("billing")}
            >
              Manage billing
            </button>
            <button
              type="button"
              className="btn-line"
              disabled={suspended}
              onClick={() => setDialog("upgrade")}
            >
              Upgrade
            </button>
          </div>
        </div>
        <div className="card">
          <div className="card-title" style={{ marginBottom: 8 }}>
            What your license covers
          </div>
          {(plan?.features ?? []).map((line) => (
            <div key={line} className="check-row">
              <span className="check-circle">
                <Icon name="check" size={12} />
              </span>
              <span className="check-text" style={{ fontSize: 13 }}>
                {line}
              </span>
            </div>
          ))}
          {(plan?.features.length ?? 0) === 0 && (
            <div className="empty-note">The operator hasn't listed features for this plan yet.</div>
          )}
        </div>
      </div>
      <div className="card">
        <div className="card-title" style={{ marginBottom: 6 }}>
          Invoices
        </div>
        <table className="itable">
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Date</th>
              <th>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {invoicesFor(client, plan?.priceMonthly ?? 0).map((inv) => (
              <tr key={inv.id}>
                <td className="cell-version">{inv.id}</td>
                <td>{inv.date}</td>
                <td>{inv.amount}</td>
                <td>
                  <Pill tone="success">{inv.status}</Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {dialog === "billing" && (
        <ManageBillingModal fleet={fleet} client={client} onClose={() => setDialog(null)} />
      )}
      {dialog === "upgrade" && (
        <UpgradeModal fleet={fleet} client={client} onClose={() => setDialog(null)} />
      )}
    </>
  );
}

// ---------- support ----------

function SupportView({
  fleet,
  client,
  instance,
  suspended,
}: {
  fleet: FleetState;
  client: ClientAccount;
  instance: Instance;
  suspended: boolean;
}) {
  const [ticketOpen, setTicketOpen] = useState(false);
  const open = instance.tickets.filter((t) => t.status === "Open");
  const rest = instance.tickets.filter((t) => t.status !== "Open");
  const plan = getPlan(fleet, client.license.planId);
  return (
    <>
      <div className="card">
        <div className="card-head" style={{ marginBottom: 4 }}>
          <span className="card-title">Support</span>
          <span className="card-sub">
            avg first response 4h · {plan?.name ?? "current"} plan · {instance.clientName}
          </span>
          <div className="card-head-spacer" />
          <button
            type="button"
            className="btn btn-primary"
            disabled={suspended}
            onClick={() => setTicketOpen(true)}
          >
            New ticket
          </button>
        </div>
        {open.length > 0 && (
          <>
            {open.map((ticket) => (
              <div key={ticket.id} className="ticket-row">
                <span className="ticket-body">
                  <span className="ticket-subject">{ticket.subject}</span>
                  <span className="ticket-meta">{ticket.meta}</span>
                </span>
                <Pill tone="danger">Open</Pill>
              </div>
            ))}
          </>
        )}
        {rest.map((ticket) => (
          <div key={ticket.id} className="ticket-row">
            <span className="ticket-body">
              <span className="ticket-subject">{ticket.subject}</span>
              <span className="ticket-meta">{ticket.meta}</span>
            </span>
            <Pill tone="success">{ticket.status}</Pill>
          </div>
        ))}
        {instance.tickets.length === 0 && (
          <div className="empty-note">No tickets yet — we're here when you need us.</div>
        )}
      </div>
      {ticketOpen && <NewTicketModal instance={instance} onClose={() => setTicketOpen(false)} />}
    </>
  );
}
