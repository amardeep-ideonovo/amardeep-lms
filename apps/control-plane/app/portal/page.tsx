"use client";

// Client dashboard (license-holder portal) — session-driven over the mock
// store. A license runs up to effectiveCap(license) instances:
//   0 owned            → "Launch <academy>" onboarding card (self-serve provision)
//   ≥1 owned           → switcher (when >1) + full dashboard for the SELECTED
//                        instance, plus a "Provision another instance" card
//                        while under the cap, or an upgrade prompt at the cap.
//   selected booting   → boot progress card
// A suspended license shows the shell banner and disables every mutating
// action. The seeded demo session (?demo=1) binds to Harbor Yoga.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Icon } from "@/components/icons";
import { InstanceSwitcher } from "@/components/instance-switcher";
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
import { useSelectedInstance } from "@/lib/instance-selection";
import {
  activePlans,
  clientInstances,
  displayStatus,
  effectiveCap,
  effectiveTrack,
  getPlan,
  initialsOf,
  licenseSummary,
  portalClient,
  provisionOwnInstance,
  scheduleUpdate,
  uptimeLabel,
} from "@/lib/provisioner";
import { useFleet } from "@/lib/useFleet";
import type { AppTrack, ClientAccount, FleetState, Instance } from "@/lib/types";

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
  const owned = fleet && client ? clientInstances(fleet, client.id) : [];
  const [selected, setSelected] = useSelectedInstance(owned);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  if (!fleet || !session || !client) return <PageSkeleton />;

  const suspended = client.license.status === "suspended";
  const cap = effectiveCap(fleet, client.license);

  if (owned.length === 0 || !selected) {
    return <LaunchAcademyCard fleet={fleet} client={client} suspended={suspended} />;
  }

  const underCap = owned.length < cap;
  const upgradeTarget = activePlans(fleet).some(
    (p) => p.id !== client.license.planId && p.instanceCap > cap
  );

  return (
    <div className="stack page-in">
      {owned.length > 1 && (
        <InstanceSwitcher instances={owned} selectedId={selected.id} onSelect={setSelected} />
      )}
      {selected.status === "Provisioning" ? (
        <ProvisioningCard instance={selected} bootSteps={fleet.bootSteps} />
      ) : (
        <InstanceDashboard fleet={fleet} client={client} instance={selected} suspended={suspended} />
      )}

      {underCap && !suspended && (
        <ProvisionAnotherCard client={client} used={owned.length} cap={cap} />
      )}
      {underCap && suspended && (
        <div className="card">
          <div className="empty-note" style={{ padding: "2px 0" }}>
            License suspended — provisioning is disabled until it's reactivated.
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
    </div>
  );
}

// ---------- onboarding: no instance yet ----------

function LaunchAcademyCard({
  fleet,
  client,
  suspended,
}: {
  fleet: FleetState;
  client: ClientAccount;
  suspended: boolean;
}) {
  const [academy, setAcademy] = useState(client.academyName);
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const plan = getPlan(fleet, client.license.planId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!academy.trim()) {
      setError("Give your academy a name — it appears on your member site.");
      return;
    }
    setError(null);
    setBusy(true);
    const result = await provisionOwnInstance(client.id, { name: academy, domain });
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
    }
    // On success the store flips this page to the provisioning card on its own.
  };

  return (
    <div className="stack page-in">
      <div className="card onboard-card">
        <div className="card-head" style={{ marginBottom: 4 }}>
          <span className="hero-tile">{initialsOf(academy || client.academyName)}</span>
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span className="hero-name">Launch {academy.trim() || client.academyName}</span>
            <span className="card-sub">
              Your {plan?.name ?? "current"} license is active — one step left.
            </span>
          </span>
          <div className="card-head-spacer" />
          <Pill tone={suspended ? "warning" : "success"}>
            {suspended ? "License suspended" : `${plan?.name ?? "Active"} license`}
          </Pill>
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
            disabled={busy || suspended}
            style={{ padding: "12px 18px", alignSelf: "flex-start" }}
          >
            {suspended ? "License suspended" : busy ? "Starting the boot…" : "Provision my instance"}
          </button>
        </form>
      </div>
    </div>
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

// ---------- onboarding: instance booting ----------

function ProvisioningCard({ instance, bootSteps }: { instance: Instance; bootSteps: string[] }) {
  return (
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
  );
}

// ---------- the full dashboard (Running / Stopped / Suspended) ----------

function InstanceDashboard({
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
  const router = useRouter();
  const [dialog, setDialog] = useState<PortalDialog>(null);
  const [downloading, setDownloading] = useState(false);

  const status = displayStatus(instance);
  const backupsPreview = instance.backups.entries.slice(0, 2);
  const hasBackups = instance.backups.entries.length > 0;
  const plan = getPlan(fleet, client.license.planId);
  const track = effectiveTrack(fleet, client.license);

  return (
    <>
      {/* ---- instance hero card ---- */}
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
              disabled={!!instance.restoreInProgress || !hasBackups || suspended}
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
              disabled={!instance.updateAvailable || instance.updateScheduled || suspended}
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
        <MobileOverviewCard
          instance={instance}
          track={track}
          suspended={suspended}
          onRequestBuild={() => setDialog("build")}
          onUpgrade={() => setDialog("upgrade")}
        />

        <div className="card">
          <div className="card-title">License &amp; billing</div>
          <div className="price-row">
            <span className="price-big">
              {plan?.name ?? client.license.planId} — ${plan?.priceMonthly ?? 0}
            </span>
            <span className="price-per">/month</span>
          </div>
          <div className="license-copy">
            {suspended ? "Suspended" : `Renews ${client.license.renewsAt}`} · {client.license.cardBrand}{" "}
            •••• {client.license.cardLast4}
            <br />
            Includes {licenseSummary(fleet, client.license)}
          </div>
          <div className="card-btn-row" style={{ marginTop: 13 }}>
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
            disabled={suspended}
            onClick={() => setDialog("ticket")}
          >
            New ticket
          </button>
        </div>
      </div>

      {dialog === "restore" && <RestoreModal instance={instance} onClose={() => setDialog(null)} />}
      {dialog === "ticket" && <NewTicketModal instance={instance} onClose={() => setDialog(null)} />}
      {dialog === "build" && <RequestBuildModal instance={instance} onClose={() => setDialog(null)} />}
      {dialog === "billing" && (
        <ManageBillingModal fleet={fleet} client={client} onClose={() => setDialog(null)} />
      )}
      {dialog === "upgrade" && (
        <UpgradeModal fleet={fleet} client={client} onClose={() => setDialog(null)} />
      )}
      {dialog === "changelog" && <ChangelogModal onClose={() => setDialog(null)} />}
    </>
  );
}

// ---------- mobile card (varies by the license's effective app track) ----------

function MobileOverviewCard({
  instance,
  track,
  suspended,
  onRequestBuild,
  onUpgrade,
}: {
  instance: Instance;
  track: AppTrack;
  suspended: boolean;
  onRequestBuild: () => void;
  onUpgrade: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const shortName = instance.clientName.replace(" School", "");

  if (track === "none") {
    return (
      <div className="card">
        <div className="card-head baseline">
          <span className="card-title">Mobile apps</span>
          <div className="card-head-spacer" />
          <Pill tone="neutral">Web only</Pill>
        </div>
        <p className="modal-note" style={{ marginTop: 10 }}>
          Your plan is web-only — upgrade to put {shortName} in your members' pockets with the shared
          Spotlight app or your own white-label apps.
        </p>
        <button
          type="button"
          className="btn-line btn-line-teal btn-block"
          style={{ marginTop: 12, padding: 10 }}
          disabled={suspended}
          onClick={onUpgrade}
        >
          Upgrade for mobile apps
        </button>
      </div>
    );
  }

  if (track === "shared") {
    return (
      <div className="card">
        <div className="card-head baseline">
          <span className="card-title">Mobile apps</span>
          <div className="card-head-spacer" />
          <Pill tone="info">Shared app</Pill>
        </div>
        <div className="connect-code" style={{ marginTop: 10 }}>
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
            {copied ? "Copied ✓" : "Copy"}
          </button>
        </div>
        <p className="modal-note" style={{ marginTop: 10 }}>
          Members install the shared Spotlight app and enter this connect code — your branding and
          content load automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head baseline">
        <span className="card-title">Mobile apps</span>
        <div className="card-head-spacer" />
        <button type="button" className="link-teal" disabled={suspended} onClick={onRequestBuild}>
          Request build
        </button>
      </div>
      {(
        [
          ["iOS", instance.mobileBuilds.ios],
          ["Android", instance.mobileBuilds.android],
        ] as const
      ).map(([platform, build]) => (
        <div key={platform} className="mrow" style={platform === "iOS" ? { marginTop: 10 } : undefined}>
          <span className="mrow-icon">
            <Icon name="smartphone" size={15} />
          </span>
          <span className="mrow-body">
            <span className="mrow-title">
              {platform} — {shortName}
            </span>
            <span className="mrow-meta">
              {build.version} · {build.detail}
            </span>
          </span>
          <Pill
            tone={
              build.status === "Live"
                ? "success"
                : build.status === "In review"
                  ? "warning"
                  : build.status === "Building"
                    ? "info"
                    : "neutral"
            }
          >
            {build.status}
          </Pill>
        </div>
      ))}
    </div>
  );
}
