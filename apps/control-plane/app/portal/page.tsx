"use client";

// Client dashboard (license-holder portal) — session-driven over the mock
// store. Three states:
//   1. no instance yet  → "Launch <academy>" onboarding card (self-serve provision)
//   2. Provisioning     → boot progress card
//   3. Running          → frame-1b dashboard: hero, quotas, health, backups,
//                         version, mobile apps, license & billing, support —
//                         with zero-states for a freshly provisioned instance.
// The seeded demo session (?demo=1) binds to Harbor Yoga and renders exactly
// as before.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Icon } from "@/components/icons";
import {
  ChangelogModal,
  handleDownloadBackup,
  ManageBillingModal,
  NewTicketModal,
  RequestBuildModal,
  RestoreModal,
  UpgradeModal,
} from "@/components/portal-modals";
import { Field, Kebab, PageSkeleton, Pill } from "@/components/ui";
import { useClientSession } from "@/lib/auth";
import {
  displayStatus,
  initialsOf,
  portalClient,
  portalInstance,
  provisionOwnInstance,
  scheduleUpdate,
} from "@/lib/provisioner";
import { useFleet } from "@/lib/useFleet";
import type { ClientAccount, Instance } from "@/lib/types";

type PortalDialog =
  | "restore"
  | "ticket"
  | "build"
  | "billing"
  | "upgrade"
  | "changelog"
  | null;

export default function PortalOverview() {
  const session = useClientSession();
  const fleet = useFleet();

  const client = fleet ? portalClient(fleet, session) : undefined;
  const instance = fleet ? portalInstance(fleet, client) : undefined;
  if (!fleet || !session || !client) return <PageSkeleton />;

  if (!instance) return <LaunchAcademyCard client={client} />;
  if (instance.status === "Provisioning") {
    return <ProvisioningCard instance={instance} bootSteps={fleet.bootSteps} />;
  }
  return <InstanceDashboard instance={instance} />;
}

// ---------- onboarding: no instance yet ----------

function LaunchAcademyCard({ client }: { client: ClientAccount }) {
  const [academy, setAcademy] = useState(client.academyName);
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!academy.trim()) {
      setError("Give your academy a name — it appears on your member site.");
      return;
    }
    setError(null);
    setBusy(true);
    await provisionOwnInstance(client.id, { name: academy, domain });
    // The store flips this page to the provisioning card on its own.
  };

  return (
    <div className="stack page-in">
      <div className="card onboard-card">
        <div className="card-head" style={{ marginBottom: 4 }}>
          <span className="hero-tile">{initialsOf(academy || client.academyName)}</span>
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span className="hero-name">Launch {academy.trim() || client.academyName}</span>
            <span className="card-sub">
              Your {client.license.plan} license is active — one step left.
            </span>
          </span>
          <div className="card-head-spacer" />
          <Pill tone="success">{client.license.plan} license</Pill>
        </div>
        <p className="modal-note" style={{ margin: "10px 0 16px", maxWidth: 480 }}>
          Provisioning brings up your own fully isolated stack — database, media storage, admin
          panel, member site and job queue — with a first admin account for {client.email}.
        </p>
        <form onSubmit={submit} className="modal-body" style={{ maxWidth: 480 }}>
          <Field label="Academy name">
            <input
              className="input"
              autoComplete="organization"
              value={academy}
              onChange={(e) => setAcademy(e.target.value)}
              autoFocus
            />
          </Field>
          <Field label="Domain" hint="Optional for now — point DNS whenever you're ready.">
            <input
              className="input mono"
              placeholder="youracademy.com"
              autoComplete="off"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
            />
          </Field>
          {error && <p className="form-error">{error}</p>}
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy}
            style={{ padding: "12px 18px", alignSelf: "flex-start" }}
          >
            {busy ? "Starting the boot…" : "Provision my instance"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ---------- onboarding: instance booting ----------

function ProvisioningCard({ instance, bootSteps }: { instance: Instance; bootSteps: string[] }) {
  return (
    <div className="stack page-in">
      <div className="card onboard-card">
        <div className="card-head" style={{ marginBottom: 10 }}>
          <span className="hero-tile">{initialsOf(instance.clientName)}</span>
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span className="hero-name">{instance.clientName}</span>
            <span className="hero-meta">
              {instance.domain} · {instance.dbName} · {instance.version}
            </span>
          </span>
          <div className="card-head-spacer" />
          <Pill tone="info">
            <span className="wave-dot active pulse" style={{ background: "currentColor" }} />
            Provisioning
          </Pill>
        </div>
        <div className="rollout-track">
          <span className="rollout-fill boot-progress" />
        </div>
        <div style={{ marginTop: 14 }}>
          {bootSteps.map((step, idx) => (
            <div key={step} className="boot-step">
              <span className="boot-num">{idx + 1}</span>
              {step}
            </div>
          ))}
        </div>
        <p className="modal-note" style={{ marginTop: 10 }}>
          Usually under a minute. This page flips to your dashboard the moment the health checks
          pass — no refresh needed.
        </p>
      </div>
    </div>
  );
}

// ---------- the full dashboard (Running / Stopped / Suspended) ----------

function InstanceDashboard({ instance }: { instance: Instance }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<PortalDialog>(null);
  const [downloading, setDownloading] = useState(false);

  const status = displayStatus(instance);
  const backupsPreview = instance.backups.entries.slice(0, 2);
  const hasBackups = instance.backups.entries.length > 0;

  return (
    <div className="stack page-in">
      {/* ---- instance hero card ---- */}
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
          <Kebab
            items={[
              {
                label: "Copy member URL",
                onSelect: () => navigator.clipboard?.writeText(instance.urls.web),
              },
              {
                label: "Copy admin URL",
                onSelect: () => navigator.clipboard?.writeText(instance.urls.admin),
              },
              {
                label: "View instance details",
                onSelect: () => router.push("/portal/instance"),
              },
            ]}
          />
        </span>
      </div>

      {/* ---- usage quota cards ---- */}
      {instance.usage.length > 0 && (
        <div className="quota-grid">
          {instance.usage.map((quota) => (
            <div key={quota.name} className="quota-card">
              <div className="quota-label">{quota.name}</div>
              <div className="quota-value-row">
                <span className="quota-value">{quota.value}</span>
                <span className="quota-limit">{quota.limitNote}</span>
              </div>
              <div className="quota-bar">
                <span className="quota-fill" style={{ width: `${quota.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ---- health | backups | version ---- */}
      <div className="grid-thirds">
        <div className="card">
          <div className="card-head baseline" style={{ marginBottom: 8 }}>
            <span className="card-title">Instance health</span>
            <div className="card-head-spacer" />
            {instance.metrics && (
              <span className="card-sub" style={{ fontSize: 11.5 }}>
                {instance.metrics.host} · {instance.metrics.region}
              </span>
            )}
          </div>
          {instance.metrics ? (
            <>
              {(
                [
                  ["CPU", instance.metrics.cpuPct],
                  ["Memory", instance.metrics.memPct],
                  ["Disk", instance.metrics.diskPct],
                ] as const
              ).map(([label, pct]) => (
                <div key={label} className="meter-row">
                  <span className="meter-name">{label}</span>
                  <span className="bar" style={{ height: 8 }}>
                    <span className="bar-fill" style={{ width: `${pct}%`, height: 8 }} />
                  </span>
                  <span className="meter-pct">{pct}%</span>
                </div>
              ))}
              <div className="ok-banner">
                <Icon name="check" size={14} />
                <span>{instance.metrics.normalNote}</span>
              </div>
            </>
          ) : (
            <div className="empty-note">Metrics appear after the first health sweep.</div>
          )}
        </div>

        <div className="card">
          <div className="card-head" style={{ marginBottom: 12 }}>
            <span className="card-title">Backups</span>
            <div className="card-head-spacer" />
            <Pill tone="neutral">{instance.backups.schedule}</Pill>
          </div>
          {instance.restoreInProgress && (
            <div className="info-banner" style={{ marginTop: 0, marginBottom: 8 }}>
              Restoring “{instance.restoreInProgress.entryLabel}” — maintenance mode is on.
            </div>
          )}
          {backupsPreview.map((entry) => (
            <div key={entry.id} className="brow">
              <span className="brow-icon">
                <Icon name="check" size={14} />
              </span>
              <span className="brow-body">
                <span className="brow-title">{entry.label}</span>
                <span className="brow-meta">{entry.detail}</span>
              </span>
            </div>
          ))}
          {!hasBackups && (
            <div className="brow">
              <span className="brow-icon">
                <Icon name="database" size={14} />
              </span>
              <span className="brow-body">
                <span className="brow-title">No snapshots yet</span>
                <span className="brow-meta">{instance.backups.retentionNote}</span>
              </span>
            </div>
          )}
          <div className="card-btn-row" style={{ marginTop: 10 }}>
            <button
              type="button"
              className="btn-line"
              disabled={downloading || !hasBackups}
              onClick={async () => {
                setDownloading(true);
                await handleDownloadBackup(instance.id);
                setDownloading(false);
              }}
            >
              {downloading ? "Preparing…" : "Download latest"}
            </button>
            <button
              type="button"
              className="btn-line"
              disabled={!!instance.restoreInProgress || !hasBackups}
              onClick={() => setDialog("restore")}
            >
              Restore…
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <span className="card-title">Version</span>
            <div className="card-head-spacer" />
            {instance.updateScheduled ? (
              <Pill tone="warning">Scheduled</Pill>
            ) : instance.updateAvailable ? (
              <Pill tone="info">{instance.updateAvailable.version} available</Pill>
            ) : (
              <Pill tone="success">Up to date</Pill>
            )}
          </div>
          <div className="version-copy">
            You are on <b>{instance.version}</b>.{" "}
            {instance.updateAvailable ? (
              <>
                {instance.updateAvailable.notes} Updates are applied by the platform team in rollout waves
                — or update now.
              </>
            ) : (
              "You're on the latest release — updates are applied by the platform team in rollout waves."
            )}
          </div>
          <div className="card-btn-row" style={{ marginTop: 13 }}>
            <button
              type="button"
              className="btn-line btn-line-ink"
              disabled={!instance.updateAvailable || instance.updateScheduled}
              onClick={() => scheduleUpdate(instance.id)}
            >
              {instance.updateScheduled ? "Scheduled for tonight ✓" : "Update tonight"}
            </button>
            <button type="button" className="btn-line" onClick={() => setDialog("changelog")}>
              Changelog
            </button>
          </div>
        </div>
      </div>

      {/* ---- mobile | license & billing | support ---- */}
      <div className="grid-thirds">
        <div className="card">
          <div className="card-head baseline">
            <span className="card-title">Mobile apps</span>
            <div className="card-head-spacer" />
            <button type="button" className="link-teal" onClick={() => setDialog("build")}>
              Request build
            </button>
          </div>
          <div className="mrow" style={{ marginTop: 10 }}>
            <span className="mrow-icon">
              <Icon name="smartphone" size={15} />
            </span>
            <span className="mrow-body">
              <span className="mrow-title">iOS — {instance.clientName.replace(" School", "")}</span>
              <span className="mrow-meta">
                {instance.mobileBuilds.ios.version} · {instance.mobileBuilds.ios.detail}
              </span>
            </span>
            <Pill
              tone={
                instance.mobileBuilds.ios.status === "Live"
                  ? "success"
                  : instance.mobileBuilds.ios.status === "In review"
                    ? "warning"
                    : instance.mobileBuilds.ios.status === "Building"
                      ? "info"
                      : "neutral"
              }
            >
              {instance.mobileBuilds.ios.status}
            </Pill>
          </div>
          <div className="mrow">
            <span className="mrow-icon">
              <Icon name="smartphone" size={15} />
            </span>
            <span className="mrow-body">
              <span className="mrow-title">Android — {instance.clientName.replace(" School", "")}</span>
              <span className="mrow-meta">
                {instance.mobileBuilds.android.version} · {instance.mobileBuilds.android.detail}
              </span>
            </span>
            <Pill
              tone={
                instance.mobileBuilds.android.status === "Live"
                  ? "success"
                  : instance.mobileBuilds.android.status === "In review"
                    ? "warning"
                    : instance.mobileBuilds.android.status === "Building"
                      ? "info"
                      : "neutral"
              }
            >
              {instance.mobileBuilds.android.status}
            </Pill>
          </div>
        </div>

        <div className="card">
          <div className="card-title">License &amp; billing</div>
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
          <div className="card-btn-row" style={{ marginTop: 13 }}>
            <button type="button" className="btn-line" onClick={() => setDialog("billing")}>
              Manage billing
            </button>
            <button type="button" className="btn-line" onClick={() => setDialog("upgrade")}>
              Upgrade
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <span className="card-title">Support</span>
            <div className="card-head-spacer" />
            {instance.tickets.filter((t) => t.status === "Open").length > 0 ? (
              <Pill tone="danger">{instance.tickets.filter((t) => t.status === "Open").length} open</Pill>
            ) : (
              <Pill tone="neutral">all clear</Pill>
            )}
          </div>
          <div style={{ marginTop: 4 }}>
            {instance.tickets.slice(0, 2).map((ticket) => (
              <div key={ticket.id} className="ticket-row">
                <span className="ticket-body">
                  <span className="ticket-subject">{ticket.subject}</span>
                  <span className="ticket-meta">{ticket.meta}</span>
                </span>
                <Link href="/portal/support" className="ticket-view">
                  View
                </Link>
              </div>
            ))}
            {instance.tickets.length === 0 && (
              <div className="empty-note">No tickets yet — we're here when you need us.</div>
            )}
          </div>
          <button
            type="button"
            className="btn-line btn-line-teal btn-block"
            style={{ marginTop: 12, padding: 10 }}
            onClick={() => setDialog("ticket")}
          >
            New ticket
          </button>
        </div>
      </div>

      {dialog === "restore" && <RestoreModal instance={instance} onClose={() => setDialog(null)} />}
      {dialog === "ticket" && <NewTicketModal instance={instance} onClose={() => setDialog(null)} />}
      {dialog === "build" && <RequestBuildModal instance={instance} onClose={() => setDialog(null)} />}
      {dialog === "billing" && <ManageBillingModal instance={instance} onClose={() => setDialog(null)} />}
      {dialog === "upgrade" && <UpgradeModal instance={instance} onClose={() => setDialog(null)} />}
      {dialog === "changelog" && <ChangelogModal onClose={() => setDialog(null)} />}
    </div>
  );
}
