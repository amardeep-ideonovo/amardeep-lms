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
import {
  openAlertCount,
  openTicketCount,
  PLAN_PRICE,
  portalClient,
  portalInstance,
  provisionInstance,
  setInstanceQuery,
} from "@/lib/provisioner";
import { useFleet } from "@/lib/useFleet";
import type { PlanTier } from "@/lib/types";
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

const PORTAL_NAV: NavGroup[] = [
  {
    label: "MY LICENSE",
    items: [
      { label: "Overview", href: "/portal", icon: "grid" },
      { label: "My instance", href: "/portal/instance", icon: "package" },
      { label: "Backups", href: "/portal/backups", icon: "database" },
      { label: "Mobile apps", href: "/portal/mobile", icon: "smartphone" },
      { label: "Billing", href: "/portal/billing", icon: "credit-card" },
      { label: "Support", href: "/portal/support", icon: "lifebuoy", badge: "tickets" },
    ],
  },
];

function titleFor(role: ShellRole, pathname: string): string {
  const nav = role === "operator" ? OPERATOR_NAV : PORTAL_NAV;
  for (const group of nav) {
    for (const item of group.items) {
      if (item.href === pathname) return item.label;
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

  if (!authed) return <div className="shell shell-blank" />;

  const nav = role === "operator" ? OPERATOR_NAV : PORTAL_NAV;
  const title = titleFor(role, pathname);
  const alertCount = fleet ? openAlertCount(fleet) : 0;
  const client = role === "client" && fleet ? portalClient(fleet, session) : undefined;
  const ownInstance = fleet ? portalInstance(fleet, client) : undefined;
  const ticketCount = fleet && ownInstance ? openTicketCount(fleet, ownInstance.id) : 0;
  const persona =
    role === "operator"
      ? fleet?.operator
      : client
        ? { name: client.name, role: `Owner · ${client.academyName}`, avatarSeed: client.avatarSeed }
        : undefined;
  const licenseSource = ownInstance?.license ?? client?.license;

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
              const active = pathname === item.href;
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
          ) : licenseSource ? (
            <span className="pill pill-teal-dark tb-license">
              {licenseSource.plan} license · renews {licenseSource.renewsAt.replace(/, \d{4}$/, "")}
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
              {ownInstance ? (
                <a
                  href={ownInstance.urls.admin}
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
        <main className="content">{children}</main>
      </div>

      {provisionOpen && <ProvisionModal onClose={() => setProvisionOpen(false)} />}
    </div>
  );
}

// ---------- provision modal (operator) ----------

function ProvisionModal({ onClose }: { onClose: () => void }) {
  const [id, setId] = useState("");
  const [domain, setDomain] = useState("");
  const [plan, setPlan] = useState<PlanTier>("Pro");
  const [adminEmail, setAdminEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const slug = id.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(slug)) {
      setError("Instance id must be a short slug (a–z, 0–9, dashes).");
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
    setBusy(true);
    await provisionInstance({ id: slug, domain, plan, adminEmail });
    onClose();
  };

  return (
    <Modal title="Provision instance" onClose={onClose} width={460}>
      <form onSubmit={submit}>
        <div className="modal-body">
          <p className="modal-note">
            Brings up a fully isolated stack — <span className="mono">docker compose -p lms_{id.trim() || "<id>"}</span>{" "}
            with its own Postgres, Redis and uploads volumes, unique secrets, and a seeded first admin.
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
          <Field label="Plan">
            <select className="input" value={plan} onChange={(e) => setPlan(e.target.value as PlanTier)}>
              {(Object.keys(PLAN_PRICE) as PlanTier[]).map((tier) => (
                <option key={tier} value={tier}>
                  {tier} — ${PLAN_PRICE[tier]}/mo
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
