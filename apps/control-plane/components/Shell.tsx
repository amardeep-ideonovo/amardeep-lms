"use client";

// Ink Hero shell for the operator console + client portal — transcribed from
// frames 1a/1b: 236px ink sidebar, 60px ink topbar, light content area with a
// 22px 0 0 0 radius where it meets the chrome.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FormEvent, ReactNode, useEffect, useState } from "react";
import {
  ClientSession,
  clientSignOut,
  getClientSession,
  isOperator,
  operatorSignOut,
  startDemoSession,
} from "@/lib/auth";
import { useSelectedInstance } from "@/lib/instance-selection";
import {
  activePlans,
  clientInstances,
  effectiveCap,
  getPlan,
  instanceIdTaken,
  openAlertCount,
  openTicketCountForClient,
  portalClient,
  provisionInstance,
  setInstanceQuery,
} from "@/lib/provisioner";
import { useFleet } from "@/lib/useFleet";
import { Icon, IconName, LogoGlyph } from "./icons";
import { Field, Modal } from "./ui";

type ShellRole = "operator" | "client";

interface NavItem {
  label: string;
  href: string;
  icon: IconName;
  badge?: "alerts" | "tickets";
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const OPERATOR_NAV: NavGroup[] = [
  {
    label: "FLEET",
    items: [
      { label: "Instances", href: "/operator", icon: "package" },
      { label: "Provisioning", href: "/operator/provisioning", icon: "arrow-up" },
      { label: "Updates", href: "/operator/updates", icon: "download" },
      { label: "Backups", href: "/operator/backups", icon: "database" },
    ],
  },
  {
    label: "CLIENTS",
    items: [
      { label: "Plans", href: "/operator/plans", icon: "tag" },
      { label: "Licenses", href: "/operator/licenses", icon: "shield" },
      { label: "Clients", href: "/operator/clients", icon: "users" },
      { label: "Billing", href: "/operator/billing", icon: "credit-card" },
    ],
  },
  {
    label: "SYSTEM",
    items: [
      { label: "Hosts", href: "/operator/hosts", icon: "server" },
      { label: "Alerts", href: "/operator/alerts", icon: "alert-triangle", badge: "alerts" },
      { label: "Audit log", href: "/operator/audit", icon: "file-text" },
      { label: "Settings", href: "/operator/settings", icon: "settings" },
    ],
  },
];

function portalNav(multiInstance: boolean): NavGroup[] {
  return [
    {
      label: "MY LICENSE",
      items: [
        { label: "Overview", href: "/portal", icon: "grid" },
        {
          label: multiInstance ? "My instances" : "My instance",
          href: "/portal/instance",
          icon: "package",
        },
        { label: "Backups", href: "/portal/backups", icon: "database" },
        { label: "Mobile apps", href: "/portal/mobile", icon: "smartphone" },
        { label: "Billing", href: "/portal/billing", icon: "credit-card" },
        { label: "Support", href: "/portal/support", icon: "lifebuoy", badge: "tickets" },
      ],
    },
  ];
}

/** Static export serves trailing-slash URLs — normalize before matching. */
function normalizePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

function titleFor(role: ShellRole, nav: NavGroup[], pathname: string): string {
  const path = normalizePath(pathname);
  for (const group of nav) {
    for (const item of group.items) {
      if (item.href === path) return item.label;
    }
  }
  return role === "operator" ? "Instances" : "Overview";
}

export function Shell({ role, children }: { role: ShellRole; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const fleet = useFleet();
  const [authed, setAuthed] = useState(false);
  const [session, setSession] = useState<ClientSession | null>(null);
  const [provisionOpen, setProvisionOpen] = useState(false);

  // UI-only auth guards — two fully separate surfaces:
  //   operator → its own internal sign-in at /operator/login;
  //   client   → /login, except "?demo=1" seeds the Harbor Yoga demo session.
  useEffect(() => {
    if (role === "operator") {
      if (!isOperator()) {
        router.replace("/operator/login");
        return;
      }
      setAuthed(true);
      return;
    }
    let clientSession = getClientSession();
    if (!clientSession && typeof window !== "undefined") {
      const demo = new URLSearchParams(window.location.search).get("demo") === "1";
      if (demo) clientSession = startDemoSession();
    }
    if (!clientSession) {
      router.replace("/login");
      return;
    }
    setSession(clientSession);
    setAuthed(true);
  }, [role, router]);

  // Stale client session (account no longer in the persisted store) → sign out.
  useEffect(() => {
    if (role !== "client" || !authed || !fleet || !session) return;
    if (!portalClient(fleet, session)) {
      clientSignOut();
      router.replace("/login");
    }
  }, [role, authed, fleet, session, router]);

  const client = role === "client" && fleet ? portalClient(fleet, session) : undefined;
  const owned = fleet && client ? clientInstances(fleet, client.id) : [];
  const [selectedInstance] = useSelectedInstance(owned);

  if (!authed) return <div className="shell shell-blank" />;

  const cap = fleet && client ? effectiveCap(fleet, client.license) : 1;
  const multiInstance = cap > 1 || owned.length > 1;
  const nav = role === "operator" ? OPERATOR_NAV : portalNav(multiInstance);
  const title = titleFor(role, nav, pathname);
  const path = normalizePath(pathname);
  const alertCount = fleet ? openAlertCount(fleet) : 0;
  const ticketCount = fleet && client ? openTicketCountForClient(fleet, client.id) : 0;
  const persona =
    role === "operator"
      ? fleet?.operator
      : client
        ? { name: client.name, role: `Owner · ${client.academyName}`, avatarSeed: client.avatarSeed }
        : undefined;
  const plan = fleet && client ? getPlan(fleet, client.license.planId) : undefined;
  const licenseSuspended = client?.license.status === "suspended";

  const signOut = () => {
    if (role === "operator") {
      operatorSignOut();
      router.replace("/operator/login");
    } else {
      clientSignOut();
      router.replace("/login");
    }
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/" className="sb-logo">
          <LogoGlyph size={22} />
          <span className="sb-logo-text">
            <span className="sb-logo-name">Spotlight LMS</span>
            <span className="sb-logo-sub">{role === "operator" ? "CONTROL PLANE" : "CLIENT PORTAL"}</span>
          </span>
        </Link>
        {nav.map((group) => (
          <div key={group.label}>
            <div className="sb-group">{group.label}</div>
            {group.items.map((item) => {
              const active = path === item.href;
              const badge =
                item.badge === "alerts" ? alertCount : item.badge === "tickets" ? ticketCount : 0;
              return (
                <Link key={item.href} href={item.href} className={`sb-item${active ? " active" : ""}`}>
                  <Icon name={item.icon} size={17} />
                  {item.label}
                  {item.badge && badge > 0 ? <span className="sb-badge">{badge}</span> : null}
                </Link>
              );
            })}
          </div>
        ))}
        <div className="sb-spacer" />
        {persona ? (
          <div className="sb-user">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://picsum.photos/seed/${persona.avatarSeed}/200/200`}
              alt={persona.name}
              className="sb-avatar"
            />
            <span className="sb-user-text">
              <span className="sb-user-name">{persona.name}</span>
              <span className="sb-user-role">{persona.role}</span>
            </span>
            <button type="button" className="sb-signout" onClick={signOut}>
              Sign out
            </button>
          </div>
        ) : null}
      </aside>

      <div className="main">
        <header className="topbar">
          <span className="tb-title">{title}</span>
          {role === "operator" ? (
            <span className="tb-env">PRODUCTION</span>
          ) : licenseSuspended ? (
            <span className="pill pill-warning tb-license">License suspended</span>
          ) : plan && client ? (
            <span className="pill pill-teal-dark tb-license">
              {plan.name} license · renews {client.license.renewsAt.replace(/, \d{4}$/, "")}
            </span>
          ) : null}
          <div className="tb-spacer" />
          {role === "operator" ? (
            <>
              <label className="tb-search">
                <Icon name="search" size={14} />
                <input
                  type="search"
                  placeholder="Search instances, clients…"
                  value={fleet?.ui.instanceQuery ?? ""}
                  onChange={(e) => setInstanceQuery(e.target.value)}
                />
              </label>
              <Link href="/operator/alerts" className="tb-bell" aria-label={`Alerts (${alertCount} open)`}>
                <Icon name="bell" size={20} />
                {alertCount > 0 && <span className="tb-bell-dot" />}
              </Link>
              <button type="button" className="btn btn-primary" onClick={() => setProvisionOpen(true)}>
                + Provision instance
              </button>
            </>
          ) : (
            <>
              <Link href="/" className="btn btn-ghost-dark">
                Docs
              </Link>
              {selectedInstance ? (
                <a
                  href={selectedInstance.urls.admin}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-primary"
                >
                  Open admin
                </a>
              ) : null}
            </>
          )}
        </header>
        <main className="content">
          {role === "client" && licenseSuspended && (
            <div className="suspend-banner" role="alert">
              <Icon name="alert-triangle" size={16} />
              <span>
                <b>License suspended</b> — your instances keep running, but portal actions are
                disabled. Contact support to reactivate.
              </span>
            </div>
          )}
          {children}
        </main>
      </div>

      {provisionOpen && <ProvisionModal onClose={() => setProvisionOpen(false)} />}
    </div>
  );
}

// ---------- provision modal (operator — new license holder + first instance) ----------

function ProvisionModal({ onClose }: { onClose: () => void }) {
  const fleet = useFleet();
  const plans = fleet ? activePlans(fleet) : [];
  const [id, setId] = useState("");
  const [domain, setDomain] = useState("");
  const [planId, setPlanId] = useState<string>("");
  const [adminEmail, setAdminEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectivePlanId = planId || plans.find((p) => p.featured)?.id || plans[0]?.id || "";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const slug = id.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(slug)) {
      setError("Instance id must be a short slug (a–z, 0–9, dashes).");
      return;
    }
    if (instanceIdTaken(slug)) {
      setError(`Instance id "${slug}" is already taken.`);
      return;
    }
    if (!domain.trim()) {
      setError("Domain is required.");
      return;
    }
    if (!/.+@.+\..+/.test(adminEmail)) {
      setError("A valid admin email is required — the seeded first admin is created with it.");
      return;
    }
    if (!effectivePlanId) {
      setError("Pick a plan — activate one in the Plans section first.");
      return;
    }
    setBusy(true);
    const result = await provisionInstance({ id: slug, domain, planId: effectivePlanId, adminEmail });
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }
    onClose();
  };

  return (
    <Modal title="Provision instance" onClose={onClose} width={460}>
      <form onSubmit={submit}>
        <div className="modal-body">
          <p className="modal-note">
            Brings up a fully isolated stack for a NEW license holder —{" "}
            <span className="mono">docker compose -p lms_{id.trim() || "<id>"}</span> with its own
            Postgres, Redis and uploads volumes, unique secrets, and a seeded first admin. The client
            account + license are created alongside it.
          </p>
          <Field label="Instance id" hint="Compose project + database become lms_<id>.">
            <input
              className="input mono"
              placeholder="acme"
              value={id}
              onChange={(e) => setId(e.target.value)}
              autoFocus
            />
          </Field>
          <Field label="Domain">
            <input
              className="input mono"
              placeholder="academy.acme.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
            />
          </Field>
          <Field label="Plan" hint="From the catalog — edit plans in the Plans section.">
            <select className="input" value={effectivePlanId} onChange={(e) => setPlanId(e.target.value)}>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — ${p.priceMonthly}/mo · cap {p.instanceCap}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Admin email" hint="First boot runs migrate deploy + seed and creates this admin.">
            <input
              className="input"
              type="email"
              placeholder="owner@acme.com"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
            />
          </Field>
          {error && <p className="form-error">{error}</p>}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Provisioning…" : "Provision"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
