"use client";

// Portal sidebar sections — live views over the signed-in client's OWN
// instance in the mock store (the demo session binds to Harbor Yoga):
// my instance, backups, mobile apps, billing, support.

import Link from "next/link";
import { notFound } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icons";
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
import { displayStatus, initialsOf, portalClient, portalInstance } from "@/lib/provisioner";
import { useFleet } from "@/lib/useFleet";
import type { Instance, MobileBuild } from "@/lib/types";
import { SECTIONS, type Section } from "./sections";

export default function PortalSection({ section: sectionParam }: { section: string }) {
  const session = useClientSession();
  const fleet = useFleet();
  if (!SECTIONS.includes(sectionParam as Section)) notFound();

  const client = fleet ? portalClient(fleet, session) : undefined;
  const instance = fleet ? portalInstance(fleet, client) : undefined;
  if (!fleet || !session || !client) return <PageSkeleton />;

  if (!instance) {
    return (
      <div className="stack page-in">
        <div className="card onboard-card">
          <div className="card-head" style={{ marginBottom: 6 }}>
            <span className="card-title">No instance yet</span>
          </div>
          <p className="modal-note" style={{ marginBottom: 14, maxWidth: 460 }}>
            Your {client.license.plan} license is active, but {client.academyName} hasn't been
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

  const section = sectionParam as Section;
  return (
    <div className="stack page-in">
      {section === "instance" && <InstanceView instance={instance} />}
      {section === "backups" && <BackupsView instance={instance} />}
      {section === "mobile" && <MobileView instance={instance} />}
      {section === "billing" && <BillingView instance={instance} />}
      {section === "support" && <SupportView instance={instance} />}
    </div>
  );
}

// ---------- my instance ----------

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
            {instance.domain} · {instance.dbName} · {instance.version} · uptime{" "}
            {instance.uptimePct === null ? "—" : `${instance.uptimePct}%`} (30d)
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

function BackupsView({ instance }: { instance: Instance }) {
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
            disabled={!!instance.restoreInProgress || instance.backups.entries.length === 0}
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

// ---------- mobile apps ----------

function buildTone(build: MobileBuild): "success" | "warning" | "info" | "neutral" {
  if (build.status === "Live") return "success";
  if (build.status === "In review") return "warning";
  if (build.status === "Building") return "info";
  return "neutral";
}

function MobileView({ instance }: { instance: Instance }) {
  const [buildOpen, setBuildOpen] = useState(false);
  const shortName = instance.clientName.replace(" School", "");
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
          <button type="button" className="btn btn-primary" onClick={() => setBuildOpen(true)}>
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

// ---------- billing ----------

const HARBOR_INVOICES: Array<{ id: string; date: string; amount: string; status: "Paid" }> = [
  { id: "INV-0231", date: "Jun 12, 2026", amount: "$249.00", status: "Paid" },
  { id: "INV-0198", date: "May 12, 2026", amount: "$249.00", status: "Paid" },
  { id: "INV-0164", date: "Apr 12, 2026", amount: "$249.00", status: "Paid" },
];

/** Harbor keeps its seeded history; a fresh self-serve academy has just the signup charge. */
function invoicesFor(instance: Instance): Array<{ id: string; date: string; amount: string; status: "Paid" }> {
  if (instance.id === "harbor") return HARBOR_INVOICES;
  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return [
    {
      id: `INV-${instance.id.slice(0, 6).toUpperCase()}-001`,
      date: today,
      amount: `$${instance.license.priceMonthly}.00`,
      status: "Paid",
    },
  ];
}

function BillingView({ instance }: { instance: Instance }) {
  const [dialog, setDialog] = useState<"billing" | "upgrade" | null>(null);
  return (
    <>
      <div className="grid-main-rail">
        <div className="card">
          <div className="card-title">License</div>
          <div className="price-row">
            <span className="price-big">
              {instance.license.plan} — ${instance.license.priceMonthly}
            </span>
            <span className="price-per">/month</span>
          </div>
          <div className="license-copy">
            Renews {instance.license.renewsAt} · {instance.license.cardBrand} ••••{" "}
            {instance.license.cardLast4}
            <br />
            Includes {instance.license.includes}
          </div>
          <div className="card-btn-row" style={{ marginTop: 13, maxWidth: 360 }}>
            <button type="button" className="btn-line" onClick={() => setDialog("billing")}>
              Manage billing
            </button>
            <button type="button" className="btn-line" onClick={() => setDialog("upgrade")}>
              Upgrade
            </button>
          </div>
        </div>
        <div className="card">
          <div className="card-title" style={{ marginBottom: 8 }}>
            What your license covers
          </div>
          {[
            "A fully isolated instance — own database, media, queue",
            "Daily verified backups with restore drills",
            "Version updates applied in rollout waves",
            "iOS & Android apps on your store accounts",
            "Priority support with a 4h first response",
          ].map((line) => (
            <div key={line} className="check-row">
              <span className="check-circle">
                <Icon name="check" size={12} />
              </span>
              <span className="check-text" style={{ fontSize: 13 }}>
                {line}
              </span>
            </div>
          ))}
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
            {invoicesFor(instance).map((inv) => (
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
      {dialog === "billing" && <ManageBillingModal instance={instance} onClose={() => setDialog(null)} />}
      {dialog === "upgrade" && <UpgradeModal instance={instance} onClose={() => setDialog(null)} />}
    </>
  );
}

// ---------- support ----------

function SupportView({ instance }: { instance: Instance }) {
  const [ticketOpen, setTicketOpen] = useState(false);
  const open = instance.tickets.filter((t) => t.status === "Open");
  const rest = instance.tickets.filter((t) => t.status !== "Open");
  return (
    <>
      <div className="card">
        <div className="card-head" style={{ marginBottom: 4 }}>
          <span className="card-title">Support</span>
          <span className="card-sub">avg first response 4h · {instance.license.plan} plan</span>
          <div className="card-head-spacer" />
          <button type="button" className="btn btn-primary" onClick={() => setTicketOpen(true)}>
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
