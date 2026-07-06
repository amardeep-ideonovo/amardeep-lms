// ============================================================
// MOCK fleet/provisioner API — Spotlight Ops control plane.
//
// This module is a TYPED, IN-MEMORY STAND-IN for the real fleet
// service. It is shaped 1:1 on the per-instance deployment model in
// deploy/instance/ (docker-compose.instance.yml, .env.instance.example,
// README.md) so it can be swapped for a real fleet API without
// touching the UI. State lives in a module-level mutable store, so
// interactions persist for the browser session; every function
// resolves after ~150ms of simulated network latency.
//
// SWAP PLAN — what replaces each function when the real control-plane
// service (LocalDockerDriver, later a cloud driver) lands:
//
//   getFleetState()      → aggregate of the GETs below (or a websocket snapshot)
//   listInstances()      → GET  /fleet/instances
//                          driver: `docker compose ls` + per-project inspect
//   getInstance(id)      → GET  /fleet/instances/:id
//   provisionInstance()  → POST /fleet/instances {id, domain, plan, adminEmail}
//                          driver: mint unique secrets + allocate API/WEB/ADMIN
//                          ports, write deploy/instance/<id>.env, then
//                          `docker compose -p lms_<id> --env-file <id>.env
//                           -f docker-compose.instance.yml up -d`.
//                          Status stays "Provisioning" until the api /health
//                          check passes (migrate deploy + seeded first admin),
//                          then flips to "Running" — mocked here with a timer.
//   startInstance(id)    → POST /fleet/instances/:id/start   (compose start)
//   stopInstance(id)     → POST /fleet/instances/:id/stop    (compose stop)
//   suspendInstance(id)  → POST /fleet/instances/:id/suspend (compose stop + license flag)
//   resumeInstance(id)   → POST /fleet/instances/:id/resume  (compose start)
//   destroyInstance(id)  → DELETE /fleet/instances/:id       (compose down;
//                          `?purge=true` runs down -v and deletes pg/uploads volumes)
//   scheduleUpdate(id)   → POST /fleet/instances/:id/update {version, window:"tonight"}
//                          driver: retag images + `compose up -d` in the window
//   queueRolloutUpdate() → POST /fleet/rollouts/current/queue {instanceId}
//   getRollout()         → GET  /fleet/rollouts/current
//   pauseRollout()/resumeRollout() → POST /fleet/rollouts/current/(pause|resume)
//   listAlerts()/resolveAlert()    → GET /fleet/alerts · POST /fleet/alerts/:id/resolve
//   listHosts()          → GET  /fleet/hosts (node-exporter style host metrics)
//   listActivity()       → GET  /fleet/audit
//   runBackup(id)        → POST /fleet/instances/:id/backups (pg_dump + uploads tar
//                          from the lms_<id> volumes, then verify + off-server mirror)
//   downloadBackup(id)   → GET  /fleet/instances/:id/backups/:backupId/download
//   restoreBackup(id)    → POST /fleet/instances/:id/restore {backupId, confirm:"<id>"}
//   listTickets()/createTicket()   → GET /fleet/tickets · POST /fleet/instances/:id/tickets
//   requestMobileBuilds()→ POST /fleet/instances/:id/mobile-builds (per-client EAS track)
//   changePlan()/updateCard()      → POST /fleet/instances/:id/license (billing provider)
//   addHost()            → POST /fleet/hosts (cloud driver: order + join a VPS)
//   updateSettings()     → PUT  /fleet/settings
//   getFleetStats()      → GET  /fleet/stats
//
// SELF-SERVE verbs (sales → signup → portal journey):
//   createClientAccount()  → POST /auth/signup  (account + license; billing
//                            provider charges the plan — mocked as the 4242 card)
//   provisionOwnInstance() → POST /portal/instances {name, domain} — same
//                            pipeline as the operator provision, quota-checked
//                            against the client's license (1 license = 1 instance)
//
// PERSISTENCE (preview-only): the mutable slice — self-serve clients, their
// licenses/instances, alert resolutions, runtime activity, stat deltas — is
// mirrored to localStorage ("lms.ops.store.v1") so a signed-up client and the
// operator view of them survive reloads. The seeded fleet is always the base;
// the persisted slice replays on top at module init. Corrupt/old blobs are
// discarded silently.
// ============================================================

import type {
  ActivityEntry,
  ClientAccount,
  FleetAlert,
  FleetState,
  Host,
  Instance,
  InstanceHealth,
  OpsSettings,
  PlanTier,
  ProvisionInput,
  Rollout,
  StatusPillInfo,
  Ticket,
  UsageQuota,
} from "./types";

export const PLAN_PRICE: Record<PlanTier, number> = {
  Starter: 99,
  Pro: 249,
  Scale: 599,
};

/** License blurbs, matching the seeded fleet + sales tiers. */
export const PLAN_INCLUDES: Record<PlanTier, string> = {
  Starter: "1 instance, 500 members, weekly backups",
  Pro: "1 instance, 5,000 members, mobile apps, daily backups",
  Scale: "Up to 3 instances, unlimited members, dedicated host",
};

/** "?demo=1" sessions bind to this seeded client (Priya's Harbor Yoga School). */
export const DEMO_CLIENT_ID = "harbor";

const latency = () => new Promise<void>((r) => setTimeout(r, 150));

const HEALTHY: InstanceHealth = {
  api: "ok",
  web: "ok",
  admin: "ok",
  db: "ok",
  lastCheck: "2026-07-06T09:40:00Z",
  label: "Healthy",
  tone: "ok",
};

const UNKNOWN_HEALTH: InstanceHealth = {
  api: "unknown",
  web: "unknown",
  admin: "unknown",
  db: "unknown",
  lastCheck: "2026-07-06T09:40:00Z",
  label: "—",
  tone: "none",
};

function urlsFor(domain: string) {
  return {
    api: `https://api.${domain}`,
    web: `https://${domain}`,
    admin: `https://admin.${domain}`,
  };
}

function baseInstance(
  partial: Pick<Instance, "id" | "clientName" | "domain" | "plan"> & Partial<Instance>
): Instance {
  const price = PLAN_PRICE[partial.plan];
  return {
    dbName: `lms_${partial.id}`,
    ports: { api: 8010, web: 8011, admin: 8012 },
    urls: urlsFor(partial.domain),
    version: "v1.8.1",
    health: HEALTHY,
    membersCount: 0,
    mrr: price,
    status: "Running",
    uptimePct: 99.9,
    createdAt: "2026-01-15",
    backups: {
      schedule: "Daily · 02:00",
      lastRunAt: "Today, 02:00",
      verified: true,
      sizeMb: 1024,
      retentionNote: "30 daily copies kept · off-server mirror on",
      entries: [],
    },
    updateAvailable: null,
    updateQueued: false,
    updateScheduled: false,
    mobileBuilds: {
      ios: { status: "—", version: "—", detail: "Not requested" },
      android: { status: "—", version: "—", detail: "Not requested" },
    },
    license: {
      plan: partial.plan,
      priceMonthly: price,
      renewsAt: "Aug 1, 2026",
      cardBrand: "Visa",
      cardLast4: "4242",
      includes: "1 instance, 5,000 members, mobile apps, daily backups",
    },
    tickets: [],
    usage: [],
    metrics: null,
    owner: "—",
    restoreInProgress: null,
    ...partial,
  };
}

function seedState(): FleetState {
  const instances: Instance[] = [
    baseInstance({
      id: "spotlight",
      clientName: "Spotlight Academy",
      domain: "spotlightacademy.com",
      plan: "Pro",
      ports: { api: 8010, web: 8011, admin: 8012 },
      version: "v1.8.2",
      membersCount: 1284,
      uptimePct: 99.99,
      createdAt: "2025-11-02",
      owner: "Ava Chen",
      backups: {
        schedule: "Daily · 02:00",
        lastRunAt: "Today, 02:00",
        verified: true,
        sizeMb: 6400,
        retentionNote: "30 daily copies kept · off-server mirror on",
        entries: [],
      },
      license: {
        plan: "Pro",
        priceMonthly: 249,
        renewsAt: "Nov 2, 2026",
        cardBrand: "Visa",
        cardLast4: "5031",
        includes: "1 instance, 5,000 members, mobile apps, daily backups",
      },
      tickets: [
        {
          id: 479,
          instanceId: "spotlight",
          subject: "Bulk import 300 members from CSV",
          meta: "#479 · updated 5h ago",
          requester: "Ava Chen",
          status: "Replied",
        },
      ],
    }),
    baseInstance({
      id: "codecraft",
      clientName: "CodeCraft Bootcamp",
      domain: "codecraft.io",
      plan: "Scale",
      ports: { api: 8020, web: 8021, admin: 8022 },
      version: "v1.8.1",
      health: {
        api: "warn",
        web: "ok",
        admin: "ok",
        db: "ok",
        lastCheck: "2026-07-06T09:40:00Z",
        label: "High CPU",
        tone: "warn",
      },
      membersCount: 2051,
      uptimePct: 99.95,
      createdAt: "2025-09-18",
      owner: "Jonah Park",
      backups: {
        schedule: "Hourly",
        lastRunAt: "Today, 09:00",
        verified: true,
        sizeMb: 11200,
        retentionNote: "72 hourly + 30 daily copies kept",
        entries: [],
      },
      license: {
        plan: "Scale",
        priceMonthly: 599,
        renewsAt: "Sep 18, 2026",
        cardBrand: "Amex",
        cardLast4: "1006",
        includes: "Up to 3 instances, unlimited members, dedicated host",
      },
      tickets: [
        {
          id: 481,
          instanceId: "codecraft",
          subject: "SSO for our staff accounts?",
          meta: "#481 · updated 1h ago",
          requester: "Jonah Park",
          status: "Open",
        },
      ],
    }),
    baseInstance({
      id: "harbor",
      clientName: "Harbor Yoga School",
      domain: "harboryoga.com",
      plan: "Pro",
      ports: { api: 8030, web: 8031, admin: 8032 },
      version: "v1.8.1",
      membersCount: 412,
      uptimePct: 99.98,
      createdAt: "2026-02-12",
      owner: "Priya Sharma",
      backups: {
        schedule: "Daily · 02:00",
        lastRunAt: "Today, 02:00",
        verified: true,
        sizeMb: 2150,
        retentionNote: "30 daily copies kept · off-server mirror on",
        entries: [
          {
            id: "b-0706",
            label: "Today, 02:00 — DB + uploads",
            detail: "412 members · 2.1 GB · verified",
            sizeMb: 2150,
            verified: true,
            at: "2026-07-06T02:00:00Z",
          },
          {
            id: "b-0705",
            label: "Yesterday, 02:00",
            detail: "30 daily copies kept · off-server mirror on",
            sizeMb: 2140,
            verified: true,
            at: "2026-07-05T02:00:00Z",
          },
          {
            id: "b-0704",
            label: "Jul 4, 02:00",
            detail: "410 members · 2.1 GB · verified",
            sizeMb: 2130,
            verified: true,
            at: "2026-07-04T02:00:00Z",
          },
          {
            id: "b-0703",
            label: "Jul 3, 02:00",
            detail: "409 members · 2.1 GB · verified",
            sizeMb: 2120,
            verified: true,
            at: "2026-07-03T02:00:00Z",
          },
          {
            id: "b-0702",
            label: "Jul 2, 02:00",
            detail: "407 members · 2.0 GB · verified",
            sizeMb: 2080,
            verified: true,
            at: "2026-07-02T02:00:00Z",
          },
        ],
      },
      updateAvailable: {
        version: "v1.8.2",
        notes: "v1.8.2 adds live-session waiting rooms and faster uploads.",
      },
      mobileBuilds: {
        ios: { status: "In review", version: "v1.4", detail: "submitted Jul 3 · App Store" },
        android: { status: "Live", version: "v1.4", detail: "Google Play · 1,208 installs" },
      },
      license: {
        plan: "Pro",
        priceMonthly: 249,
        renewsAt: "Aug 12, 2026",
        cardBrand: "Visa",
        cardLast4: "4242",
        includes: "1 instance, 5,000 members, mobile apps, daily backups",
      },
      tickets: [
        {
          id: 482,
          instanceId: "harbor",
          subject: "Custom domain for the admin panel?",
          meta: "#482 · updated 3h ago · avg response 4h",
          requester: "Priya Sharma",
          status: "Open",
        },
      ],
      usage: [
        { name: "Members", value: "412", limitNote: "of 5,000", pct: 8 },
        { name: "Storage", value: "18.2 GB", limitNote: "of 50 GB", pct: 36 },
        { name: "Video minutes", value: "640", limitNote: "of 2,000 / mo", pct: 32 },
        { name: "Visits (30d)", value: "9.4k", limitNote: "bandwidth 38%", pct: 47 },
      ],
      metrics: {
        cpuPct: 34,
        memPct: 58,
        diskPct: 36,
        host: "vps-1",
        region: "Frankfurt",
        normalNote: "All systems normal — API, web, admin, database, queue",
      },
    }),
    baseInstance({
      id: "luthier",
      clientName: "Luthier's Guild",
      domain: "luthiersguild.com",
      plan: "Starter",
      ports: { api: 8040, web: 8041, admin: 8042 },
      version: "v1.7.9",
      health: {
        api: "ok",
        web: "ok",
        admin: "ok",
        db: "warn",
        lastCheck: "2026-07-06T09:40:00Z",
        label: "Backup failed",
        tone: "danger",
      },
      membersCount: 188,
      uptimePct: 99.9,
      createdAt: "2026-03-30",
      owner: "Sam Osei",
      updateQueued: true,
      backups: {
        schedule: "Weekly · Sun 02:00",
        lastRunAt: "Today, 02:00 — failed",
        verified: false,
        sizeMb: 880,
        retentionNote: "12 weekly copies kept",
        entries: [],
      },
      license: {
        plan: "Starter",
        priceMonthly: 99,
        renewsAt: "Jul 30, 2026",
        cardBrand: "Mastercard",
        cardLast4: "7719",
        includes: "1 instance, 500 members, weekly backups",
      },
      tickets: [
        {
          id: 476,
          instanceId: "luthier",
          subject: "Restore one lesson from last week?",
          meta: "#476 · updated 1d ago",
          requester: "Sam Osei",
          status: "Replied",
        },
      ],
    }),
    baseInstance({
      id: "bright",
      clientName: "Bright Kitchen Co",
      domain: "brightkitchen.co",
      plan: "Pro",
      ports: { api: 8050, web: 8051, admin: 8052 },
      version: "v1.8.2",
      health: UNKNOWN_HEALTH,
      membersCount: null,
      status: "Provisioning",
      uptimePct: null,
      createdAt: "2026-07-06",
      owner: "Dana Whitfield",
      backups: {
        schedule: "Daily · 02:00",
        lastRunAt: "—",
        verified: false,
        sizeMb: 0,
        retentionNote: "First backup runs tonight at 02:00",
        entries: [],
      },
    }),
    baseInstance({
      id: "northstar",
      clientName: "Northstar Pilates",
      domain: "northstarpilates.com",
      plan: "Starter",
      ports: { api: 8060, web: 8061, admin: 8062 },
      version: "v1.7.9",
      health: UNKNOWN_HEALTH,
      membersCount: 96,
      status: "Suspended",
      uptimePct: null,
      createdAt: "2025-12-08",
      owner: "Noah Berg",
      backups: {
        schedule: "Weekly · Sun 02:00",
        lastRunAt: "Jun 30, 02:00",
        verified: true,
        sizeMb: 460,
        retentionNote: "Volumes kept while suspended",
        entries: [],
      },
      license: {
        plan: "Starter",
        priceMonthly: 99,
        renewsAt: "lapsed Jun 30",
        cardBrand: "Visa",
        cardLast4: "0341",
        includes: "1 instance, 500 members, weekly backups",
      },
    }),
  ];

  const clients: ClientAccount[] = [
    {
      id: "harbor",
      name: "Priya Sharma",
      academyName: "Harbor Yoga School",
      email: "priya@harboryoga.com",
      plan: "Pro",
      createdAt: "2026-02-12",
      instanceId: "harbor",
      avatarSeed: "priya-av",
      license: {
        plan: "Pro",
        priceMonthly: 249,
        renewsAt: "Aug 12, 2026",
        cardBrand: "Visa",
        cardLast4: "4242",
        includes: "1 instance, 5,000 members, mobile apps, daily backups",
      },
    },
  ];

  return {
    clients,
    instances,
    rollout: {
      targetVersion: "v1.8.2",
      status: "In progress",
      updated: 18,
      total: 24,
      waves: [
        { name: "Canary", size: 2, note: "passed, 24h soak", state: "done" },
        { name: "Batch 1", size: 10, note: "done", state: "done" },
        { name: "Batch 2", size: 12, note: "6 remaining", state: "active" },
      ],
      policy: [
        "Canary instances soak for 24h before any batch starts.",
        "Health regression on any instance halts the wave automatically.",
        "Each instance updates in its own backup-checkpointed window.",
        "Client-scheduled updates (“Update tonight”) jump the queue at 02:00.",
      ],
    },
    alerts: [
      {
        id: "a-backup-luthier",
        severity: "critical",
        title: "Nightly backup failed",
        meta: "lms_luthier · 02:00 · 2 retries",
        action: "Re-run",
        instanceId: "luthier",
        at: "2026-07-06T02:12:00Z",
        resolved: false,
      },
      {
        id: "a-disk-vps2",
        severity: "warning",
        title: "Disk at 82% on vps-2",
        meta: "10 instances on host",
        action: "Inspect",
        at: "2026-07-05T22:30:00Z",
        resolved: false,
      },
      {
        id: "a-tls-codecraft",
        severity: "notice",
        title: "TLS cert renews in 12 days",
        meta: "codecraft.io · auto-renew on",
        action: "OK",
        instanceId: "codecraft",
        at: "2026-07-05T08:00:00Z",
        resolved: false,
      },
    ],
    hosts: [
      { name: "vps-1", region: "Frankfurt", instanceCount: 14, cpuPct: 41, memPct: 68, diskPct: 55 },
      { name: "vps-2", region: "Frankfurt", instanceCount: 10, cpuPct: 47, memPct: 63, diskPct: 82 },
      { name: "vps-3", region: "Amsterdam", instanceCount: 2, cpuPct: 8, memPct: 18, diskPct: 12 },
    ],
    activity: [
      {
        id: "act-1",
        actor: "Marcus Reed",
        avatarSeed: "marcus-av",
        prefix: "Provisioned ",
        target: "Bright Kitchen Co",
        suffix: " (Pro) — boot in progress",
        ago: "2h",
      },
      {
        id: "act-2",
        actor: "Dana Kovacs",
        avatarSeed: "dana-av",
        prefix: "Suspended ",
        target: "Northstar Pilates",
        suffix: " — license lapsed Jun 30",
        ago: "1d",
      },
      {
        id: "act-3",
        actor: "Marcus Reed",
        avatarSeed: "marcus-av",
        prefix: "Restored Jul 2 backup into scratch DB for ",
        target: "Harbor Yoga",
        suffix: "",
        ago: "3d",
      },
    ],
    stats: {
      licenses: 26,
      running: 24,
      mrr: 12880,
      mrrNote: "↑ 2 new licenses in Jun",
    },
    operator: { name: "Marcus Reed", role: "Platform operator", avatarSeed: "marcus-av" },
    portalUser: { name: "Priya Sharma", role: "Owner · Harbor Yoga School", avatarSeed: "priya-av" },
    settings: {
      apiImage: "lms-api:local",
      webImage: "lms-web:local",
      adminImage: "lms-admin:local",
      backupWindow: "02:00",
      canarySize: 2,
      portRangeBase: 8000,
    },
    bootSteps: [
      "Allocate API / WEB / ADMIN host ports + mint unique secrets",
      "Write deploy/instance/<id>.env (JWT_SECRET, SETTINGS_ENC_KEY, SEED_ADMIN_*)",
      "docker compose -p lms_<id> up -d  (postgres, redis, api, web, admin)",
      "prisma migrate deploy → parameterized seed creates the first admin",
      "Health checks pass (api /health, pg_isready, redis ping) → Running",
    ],
    ui: { instanceQuery: "" },
  };
}

// ---------- module-level mutable store (persisted to localStorage) ----------

/** Versioned persistence key — bump the suffix to invalidate old blobs. */
const STORE_KEY = "lms.ops.store.v1";

/** How long a mock provision takes before the /health checks "pass". */
const PROVISION_BOOT_MS = 8000;

// Frozen reference copy of the seed — used to diff/replay the persisted slice.
const SEED_BASE = seedState();
const SEED_CLIENT_IDS = new Set(SEED_BASE.clients.map((c) => c.id));
const SEED_INSTANCE_IDS = new Set(SEED_BASE.instances.map((i) => i.id));
const SEED_ACTIVITY_IDS = new Set(SEED_BASE.activity.map((a) => a.id));

/** The mutable slice mirrored to localStorage (user-created state only). */
interface PersistedStoreV1 {
  v: 1;
  clients: ClientAccount[];
  instances: Instance[];
  resolvedAlertIds: string[];
  activity: ActivityEntry[];
  /** Deltas vs the seeded base stats, so seed changes stay the base. */
  statsDelta: { licenses: number; running: number; mrr: number };
}

function readPersisted(): PersistedStoreV1 | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const blob = JSON.parse(raw) as Partial<PersistedStoreV1> | null;
    const valid =
      !!blob &&
      blob.v === 1 &&
      Array.isArray(blob.clients) &&
      Array.isArray(blob.instances) &&
      Array.isArray(blob.resolvedAlertIds) &&
      Array.isArray(blob.activity) &&
      typeof blob.statsDelta?.licenses === "number" &&
      typeof blob.statsDelta?.running === "number" &&
      typeof blob.statsDelta?.mrr === "number";
    if (!valid) {
      window.localStorage.removeItem(STORE_KEY);
      return null;
    }
    return blob as PersistedStoreV1;
  } catch {
    try {
      window.localStorage.removeItem(STORE_KEY);
    } catch {
      // ignore
    }
    return null;
  }
}

/** Seeded fleet is the base; the persisted user-created slice replays on top. */
function hydrateState(): FleetState {
  const seed = seedState();
  const saved = readPersisted();
  if (!saved) return seed;
  const resolved = new Set(saved.resolvedAlertIds);
  const merged: FleetState = {
    ...seed,
    clients: [...seed.clients, ...saved.clients.filter((c) => !SEED_CLIENT_IDS.has(c.id))],
    instances: [...seed.instances, ...saved.instances.filter((i) => !SEED_INSTANCE_IDS.has(i.id))],
    alerts: seed.alerts.map((a) => (resolved.has(a.id) ? { ...a, resolved: true } : a)),
    activity: [...saved.activity.filter((a) => !SEED_ACTIVITY_IDS.has(a.id)), ...seed.activity],
    stats: {
      ...seed.stats,
      licenses: Math.max(0, seed.stats.licenses + saved.statsDelta.licenses),
      running: Math.max(0, seed.stats.running + saved.statsDelta.running),
      mrr: Math.max(0, seed.stats.mrr + saved.statsDelta.mrr),
    },
  };
  // Replay side effects of persisted alert resolutions (e.g. luthier's re-run).
  return saved.resolvedAlertIds.reduce((s, id) => applyAlertResolutionEffects(s, id), merged);
}

function persistStore(): void {
  if (typeof window === "undefined") return;
  try {
    const slice: PersistedStoreV1 = {
      v: 1,
      clients: state.clients.filter((c) => !SEED_CLIENT_IDS.has(c.id)),
      instances: state.instances.filter((i) => !SEED_INSTANCE_IDS.has(i.id)),
      resolvedAlertIds: state.alerts.filter((a) => a.resolved).map((a) => a.id),
      activity: state.activity.filter((a) => !SEED_ACTIVITY_IDS.has(a.id)),
      statsDelta: {
        licenses: state.stats.licenses - SEED_BASE.stats.licenses,
        running: state.stats.running - SEED_BASE.stats.running,
        mrr: state.stats.mrr - SEED_BASE.stats.mrr,
      },
    };
    window.localStorage.setItem(STORE_KEY, JSON.stringify(slice));
  } catch {
    // Private mode / quota exceeded — persistence is best-effort in the preview.
  }
}

let state: FleetState = hydrateState();
const listeners = new Set<() => void>();

// Re-arm boots that were persisted mid-provision (browser only): the flip to
// Running would otherwise be lost with the reloaded timer.
if (typeof window !== "undefined") {
  for (const inst of state.instances) {
    if (!SEED_INSTANCE_IDS.has(inst.id) && inst.status === "Provisioning") {
      scheduleBootCompletion(inst.id);
    }
  }
}

function emit() {
  persistStore();
  listeners.forEach((fn) => fn());
}

function mutate(updater: (s: FleetState) => FleetState) {
  state = updater(state);
  emit();
}

function patchInstance(id: string, patch: (i: Instance) => Instance) {
  mutate((s) => ({
    ...s,
    instances: s.instances.map((i) => (i.id === id ? patch(i) : i)),
  }));
}

function prependActivity(entry: Omit<ActivityEntry, "id" | "ago">) {
  mutate((s) => ({
    ...s,
    activity: [{ ...entry, id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ago: "just now" }, ...s.activity],
  }));
}

/** Subscribe to store changes (used by the useFleet hook). */
export function subscribeFleet(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Synchronous snapshot — mock-only convenience for re-renders after mutations. */
export function getFleetSnapshot(): FleetState {
  return state;
}

// ---------- reads (async, ~150ms simulated latency) ----------

export async function getFleetState(): Promise<FleetState> {
  await latency();
  return state;
}

export async function listInstances(): Promise<Instance[]> {
  await latency();
  return state.instances;
}

export async function getInstance(id: string): Promise<Instance | undefined> {
  await latency();
  return state.instances.find((i) => i.id === id);
}

export async function getRollout(): Promise<Rollout> {
  await latency();
  return state.rollout;
}

export async function listAlerts(): Promise<FleetAlert[]> {
  await latency();
  return state.alerts;
}

export async function listHosts(): Promise<Host[]> {
  await latency();
  return state.hosts;
}

export async function listActivity(): Promise<ActivityEntry[]> {
  await latency();
  return state.activity;
}

export async function listTickets(): Promise<Ticket[]> {
  await latency();
  return state.instances.flatMap((i) => i.tickets);
}

// ---------- derived helpers (pure) ----------

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function displayStatus(i: Instance): StatusPillInfo {
  if (i.status === "Provisioning") return { label: "Provisioning", tone: "info" };
  if (i.status === "Suspended") return { label: "Suspended", tone: "neutral" };
  if (i.status === "Stopped") return { label: "Stopped", tone: "neutral" };
  if (i.status === "Failed") return { label: "Failed", tone: "danger" };
  if (i.updateScheduled) return { label: "Scheduled", tone: "warning" };
  if (i.updateQueued) return { label: "Update queued", tone: "warning" };
  return { label: "Running", tone: "success" };
}

export function openAlertCount(s: FleetState): number {
  return s.alerts.filter((a) => !a.resolved).length;
}

export function criticalAlertCount(s: FleetState): number {
  return s.alerts.filter((a) => !a.resolved && a.severity === "critical").length;
}

export function awaitingUpdateCount(s: FleetState): number {
  return Math.max(0, s.rollout.total - s.rollout.updated);
}

export function activeWaveName(s: FleetState): string {
  const active = s.rollout.waves.find((w) => w.state === "active");
  return active ? active.name.toLowerCase() : "complete";
}

export function openTicketCount(s: FleetState, instanceId?: string): number {
  const all = s.instances.flatMap((i) => i.tickets);
  return all.filter((t) => t.status === "Open" && (!instanceId || t.instanceId === instanceId)).length;
}

/** Worst utilization metric for the host-capacity bars ("82% disk"). */
export function hostWorstMetric(h: Host): { pct: number; label: string } {
  const metrics: Array<{ pct: number; label: string }> = [
    { pct: h.cpuPct, label: "cpu" },
    { pct: h.memPct, label: "memory" },
    { pct: h.diskPct, label: "disk" },
  ];
  metrics.sort((a, b) => b.pct - a.pct);
  return metrics[0];
}

function nextPortBase(s: FleetState): number {
  const maxApi = s.instances.reduce((m, i) => Math.max(m, i.ports.api), s.settings.portRangeBase);
  return maxApi + 10;
}

function clientNameFromId(id: string): string {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ---------- boot completion (shared by operator + self-serve provisions) ----------

function leastLoadedHost(s: FleetState): Host {
  const sorted = [...s.hosts].sort((a, b) => a.instanceCount - b.instanceCount);
  return sorted[0] ?? { name: "vps-1", region: "Frankfurt", instanceCount: 0, cpuPct: 0, memPct: 0, diskPct: 0 };
}

/**
 * Mock of the /health poll: flips Provisioning → Running once the boot
 * sequence (migrate deploy + seed) would have finished, places the instance
 * on the least-loaded host, and updates the fleet stats. Operator-provisioned
 * instances count their license + MRR here; self-serve licenses were already
 * counted at signup (createClientAccount), so only "running" moves.
 */
function completeBoot(id: string): void {
  const inst = state.instances.find((i) => i.id === id);
  if (!inst || inst.status !== "Provisioning") return;
  const owningClient = state.clients.find((c) => c.instanceId === id);
  const selfServe = !!owningClient;
  const host = leastLoadedHost(state);

  patchInstance(id, (i) => ({
    ...i,
    status: "Running",
    health: { ...HEALTHY, lastCheck: new Date().toISOString() },
    membersCount: 0,
    uptimePct: 100,
    metrics: {
      cpuPct: 3,
      memPct: 9,
      diskPct: 2,
      host: host.name,
      region: host.region,
      normalNote: "All systems normal — API, web, admin, database, queue",
    },
  }));
  mutate((s) => ({
    ...s,
    hosts: s.hosts.map((h) =>
      h.name === host.name ? { ...h, instanceCount: h.instanceCount + 1 } : h
    ),
    stats: {
      ...s.stats,
      running: s.stats.running + 1,
      licenses: selfServe ? s.stats.licenses : s.stats.licenses + 1,
      mrr: selfServe ? s.stats.mrr : s.stats.mrr + PLAN_PRICE[inst.plan],
    },
  }));
  prependActivity({
    actor: "Fleet monitor",
    avatarSeed: "fleet-bot",
    prefix: "",
    target: inst.clientName,
    suffix: ` is Running — first admin invite sent to ${owningClient?.email ?? inst.owner}`,
  });
}

function scheduleBootCompletion(id: string, delayMs: number = PROVISION_BOOT_MS): void {
  if (typeof window === "undefined") return;
  setTimeout(() => completeBoot(id), delayMs);
}

// ---------- lifecycle verbs (mutations) ----------

export async function provisionInstance(input: ProvisionInput): Promise<Instance> {
  await latency();
  const id = input.id.trim().toLowerCase();
  const base = nextPortBase(state);
  const clientName = clientNameFromId(id);
  const inst = baseInstance({
    id,
    clientName,
    domain: input.domain.trim().toLowerCase(),
    plan: input.plan,
    ports: { api: base, web: base + 1, admin: base + 2 },
    version: state.rollout.targetVersion,
    health: UNKNOWN_HEALTH,
    membersCount: null,
    status: "Provisioning",
    uptimePct: null,
    createdAt: new Date().toISOString().slice(0, 10),
    owner: input.adminEmail,
    backups: {
      schedule: "Daily · 02:00",
      lastRunAt: "—",
      verified: false,
      sizeMb: 0,
      retentionNote: "First backup runs tonight at 02:00",
      entries: [],
    },
  });

  mutate((s) => ({ ...s, instances: [...s.instances, inst] }));
  prependActivity({
    actor: state.operator.name,
    avatarSeed: state.operator.avatarSeed,
    prefix: "Provisioned ",
    target: clientName,
    suffix: ` (${input.plan}) — boot in progress`,
  });
  scheduleBootCompletion(id);

  return inst;
}

// ---------- self-serve accounts & provisioning (sales → signup → portal) ----------

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .replace(/-+$/, "");
}

function uniqueId(base: string, taken: (candidate: string) => boolean): string {
  const root = base || "academy";
  if (!taken(root)) return root;
  for (let n = 2; ; n += 1) {
    const candidate = `${root}-${n}`;
    if (!taken(candidate)) return candidate;
  }
}

/** Display date one month out, e.g. "Aug 6, 2026". */
function renewalDateLabel(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Fresh-instance usage quotas — near-zero values against the plan's caps. */
function zeroUsage(plan: PlanTier): UsageQuota[] {
  const members = plan === "Starter" ? "of 500" : plan === "Pro" ? "of 5,000" : "unlimited";
  const storage = plan === "Starter" ? "of 20 GB" : plan === "Pro" ? "of 50 GB" : "of 200 GB";
  const video = plan === "Starter" ? "of 500 / mo" : plan === "Pro" ? "of 2,000 / mo" : "of 10,000 / mo";
  return [
    { name: "Members", value: "0", limitNote: members, pct: 0 },
    { name: "Storage", value: "0.0 GB", limitNote: storage, pct: 0 },
    { name: "Video minutes", value: "0", limitNote: video, pct: 0 },
    { name: "Visits (30d)", value: "0", limitNote: "bandwidth 0%", pct: 0 },
  ];
}

/** Case-insensitive account lookup against the persisted store (sync — used by sign-in). */
export function findClientByEmail(email: string): ClientAccount | undefined {
  const needle = email.trim().toLowerCase();
  if (!needle) return undefined;
  return state.clients.find((c) => c.email.toLowerCase() === needle);
}

export function getClient(id: string): ClientAccount | undefined {
  return state.clients.find((c) => c.id === id);
}

export interface CreateClientInput {
  name: string;
  academyName: string;
  email: string;
  plan: PlanTier;
}

export type CreateClientResult =
  | { ok: true; client: ClientAccount }
  | { ok: false; error: string };

/**
 * Self-serve purchase: creates the client account + license records and
 * counts the new license into the fleet stats/MRR, so the operator console
 * shows the signup immediately. The instance is provisioned separately from
 * the portal (provisionOwnInstance) — 1 license = 1 instance.
 */
export async function createClientAccount(input: CreateClientInput): Promise<CreateClientResult> {
  await latency();
  const email = input.email.trim().toLowerCase();
  if (findClientByEmail(email)) {
    return { ok: false, error: "An academy is already registered to that email — sign in instead." };
  }
  const id = uniqueId(
    slugify(input.academyName),
    (candidate) =>
      state.clients.some((c) => c.id === candidate) || state.instances.some((i) => i.id === candidate)
  );
  const price = PLAN_PRICE[input.plan];
  const client: ClientAccount = {
    id,
    name: input.name.trim(),
    academyName: input.academyName.trim(),
    email,
    plan: input.plan,
    createdAt: new Date().toISOString().slice(0, 10),
    instanceId: null,
    avatarSeed: `client-${id}`,
    license: {
      plan: input.plan,
      priceMonthly: price,
      renewsAt: renewalDateLabel(),
      cardBrand: "Visa",
      cardLast4: "4242",
      includes: PLAN_INCLUDES[input.plan],
    },
  };
  mutate((s) => ({
    ...s,
    clients: [...s.clients, client],
    stats: { ...s.stats, licenses: s.stats.licenses + 1, mrr: s.stats.mrr + price },
  }));
  prependActivity({
    actor: client.name,
    avatarSeed: client.avatarSeed,
    prefix: "New license — ",
    target: client.academyName,
    suffix: ` (${input.plan}) · self-serve`,
  });
  return { ok: true, client };
}

/**
 * Portal onboarding: brings up the client's OWN instance on their license —
 * same pipeline as the operator provision (unique id/ports, fleet target
 * version, Provisioning → Running after the mock boot).
 */
export async function provisionOwnInstance(
  clientId: string,
  input: { name: string; domain: string }
): Promise<Instance | undefined> {
  await latency();
  const client = state.clients.find((c) => c.id === clientId);
  if (!client) return undefined;
  // 1 license = 1 instance — an existing live instance wins.
  if (client.instanceId) {
    const existing = state.instances.find((i) => i.id === client.instanceId);
    if (existing) return existing;
  }

  const academyName = input.name.trim() || client.academyName;
  const domainInput = input.domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
  const id = uniqueId(slugify(domainInput.split(".")[0] || academyName), (candidate) =>
    state.instances.some((i) => i.id === candidate)
  );
  const domain = domainInput || `${id}.spotlightlms.site`;
  const base = nextPortBase(state);
  const inst = baseInstance({
    id,
    clientName: academyName,
    domain,
    plan: client.plan,
    ports: { api: base, web: base + 1, admin: base + 2 },
    version: state.rollout.targetVersion,
    health: UNKNOWN_HEALTH,
    membersCount: null,
    status: "Provisioning",
    uptimePct: null,
    createdAt: new Date().toISOString().slice(0, 10),
    owner: client.name,
    usage: zeroUsage(client.plan),
    license: { ...client.license },
    backups: {
      schedule: "Daily · 02:00",
      lastRunAt: "—",
      verified: false,
      sizeMb: 0,
      retentionNote: "First backup runs tonight at 02:00",
      entries: [],
    },
  });

  mutate((s) => ({
    ...s,
    instances: [...s.instances, inst],
    clients: s.clients.map((c) => (c.id === clientId ? { ...c, academyName, instanceId: id } : c)),
  }));
  prependActivity({
    actor: client.name,
    avatarSeed: client.avatarSeed,
    prefix: "Provisioned ",
    target: academyName,
    suffix: ` (${client.plan}) — self-serve, boot in progress`,
  });
  scheduleBootCompletion(id);

  return inst;
}

// ---------- session → portal record resolution (pure helpers) ----------

/** Resolves a client session (demo or real) to its account record. */
export function portalClient(
  s: FleetState,
  session: { clientId: string } | null | undefined
): ClientAccount | undefined {
  if (!session) return undefined;
  return s.clients.find((c) => c.id === session.clientId);
}

/** Resolves a client account to their own instance (undefined while onboarding). */
export function portalInstance(s: FleetState, client: ClientAccount | undefined): Instance | undefined {
  if (!client?.instanceId) return undefined;
  return s.instances.find((i) => i.id === client.instanceId);
}

export async function startInstance(id: string): Promise<void> {
  await latency();
  const inst = state.instances.find((i) => i.id === id);
  if (!inst) return;
  patchInstance(id, (i) => ({ ...i, status: "Running", health: HEALTHY, uptimePct: i.uptimePct ?? 100 }));
  mutate((s) => ({ ...s, stats: { ...s.stats, running: s.stats.running + 1 } }));
  prependActivity({
    actor: state.operator.name,
    avatarSeed: state.operator.avatarSeed,
    prefix: "Started ",
    target: inst.clientName,
    suffix: " (docker compose start)",
  });
}

export async function stopInstance(id: string): Promise<void> {
  await latency();
  const inst = state.instances.find((i) => i.id === id);
  if (!inst) return;
  patchInstance(id, (i) => ({ ...i, status: "Stopped", health: UNKNOWN_HEALTH, uptimePct: null }));
  mutate((s) => ({ ...s, stats: { ...s.stats, running: Math.max(0, s.stats.running - 1) } }));
  prependActivity({
    actor: state.operator.name,
    avatarSeed: state.operator.avatarSeed,
    prefix: "Stopped ",
    target: inst.clientName,
    suffix: " — containers down, volumes kept",
  });
}

export async function suspendInstance(id: string): Promise<void> {
  await latency();
  const inst = state.instances.find((i) => i.id === id);
  if (!inst) return;
  const wasRunning = inst.status === "Running";
  patchInstance(id, (i) => ({ ...i, status: "Suspended", health: UNKNOWN_HEALTH, uptimePct: null }));
  mutate((s) => ({
    ...s,
    stats: {
      ...s.stats,
      running: wasRunning ? Math.max(0, s.stats.running - 1) : s.stats.running,
      mrr: Math.max(0, s.stats.mrr - inst.license.priceMonthly),
    },
  }));
  prependActivity({
    actor: state.operator.name,
    avatarSeed: state.operator.avatarSeed,
    prefix: "Suspended ",
    target: inst.clientName,
    suffix: " — license on hold, data kept",
  });
}

export async function resumeInstance(id: string): Promise<void> {
  await latency();
  const inst = state.instances.find((i) => i.id === id);
  if (!inst) return;
  patchInstance(id, (i) => ({ ...i, status: "Running", health: HEALTHY, uptimePct: 99.9 }));
  mutate((s) => ({
    ...s,
    stats: {
      ...s.stats,
      running: s.stats.running + 1,
      mrr: s.stats.mrr + inst.license.priceMonthly,
    },
  }));
  prependActivity({
    actor: state.operator.name,
    avatarSeed: state.operator.avatarSeed,
    prefix: "Resumed ",
    target: inst.clientName,
    suffix: " — license reactivated",
  });
}

/** compose down -v — removes containers AND data volumes. */
export async function destroyInstance(id: string): Promise<void> {
  await latency();
  const inst = state.instances.find((i) => i.id === id);
  if (!inst) return;
  const wasRunning = inst.status === "Running";
  const wasBilling = inst.status === "Running" || inst.status === "Provisioning" || inst.status === "Stopped";
  const hostName = inst.metrics?.host;
  mutate((s) => ({
    ...s,
    instances: s.instances.filter((i) => i.id !== id),
    // A destroyed self-serve instance sends its owner back to portal onboarding.
    clients: s.clients.map((c) => (c.instanceId === id ? { ...c, instanceId: null } : c)),
    hosts: hostName
      ? s.hosts.map((h) =>
          h.name === hostName ? { ...h, instanceCount: Math.max(0, h.instanceCount - 1) } : h
        )
      : s.hosts,
    stats: {
      ...s.stats,
      licenses: Math.max(0, s.stats.licenses - 1),
      running: wasRunning ? Math.max(0, s.stats.running - 1) : s.stats.running,
      mrr: wasBilling ? Math.max(0, s.stats.mrr - inst.license.priceMonthly) : s.stats.mrr,
    },
  }));
  prependActivity({
    actor: state.operator.name,
    avatarSeed: state.operator.avatarSeed,
    prefix: "Destroyed ",
    target: inst.clientName,
    suffix: " — compose down -v, volumes purged",
  });
}

// ---------- updates & rollout ----------

export async function scheduleUpdate(id: string): Promise<void> {
  await latency();
  const inst = state.instances.find((i) => i.id === id);
  if (!inst || !inst.updateAvailable) return;
  patchInstance(id, (i) => ({ ...i, updateScheduled: true }));
  prependActivity({
    actor: inst.owner,
    avatarSeed: "priya-av",
    prefix: "Scheduled tonight's update to ",
    target: inst.updateAvailable.version,
    suffix: ` for ${inst.clientName}`,
  });
}

export async function pauseRollout(): Promise<void> {
  await latency();
  mutate((s) => ({ ...s, rollout: { ...s.rollout, status: "Paused" } }));
  prependActivity({
    actor: state.operator.name,
    avatarSeed: state.operator.avatarSeed,
    prefix: "Paused the ",
    target: `${state.rollout.targetVersion} rollout`,
    suffix: " — in-flight updates finish, no new ones start",
  });
}

export async function resumeRollout(): Promise<void> {
  await latency();
  mutate((s) => ({ ...s, rollout: { ...s.rollout, status: "In progress" } }));
  prependActivity({
    actor: state.operator.name,
    avatarSeed: state.operator.avatarSeed,
    prefix: "Resumed the ",
    target: `${state.rollout.targetVersion} rollout`,
    suffix: "",
  });
}

// ---------- alerts ----------

/**
 * Side effects mirroring what the real resolution action would do — pure, so
 * the store hydration can replay persisted resolutions on top of the seed.
 */
function applyAlertResolutionEffects(s: FleetState, alertId: string): FleetState {
  if (alertId !== "a-backup-luthier") return s;
  return {
    ...s,
    instances: s.instances.map((i) =>
      i.id === "luthier"
        ? {
            ...i,
            health: { ...HEALTHY, lastCheck: new Date().toISOString() },
            backups: { ...i.backups, lastRunAt: "Just now — re-run", verified: true },
          }
        : i
    ),
  };
}

export async function resolveAlert(id: string): Promise<void> {
  await latency();
  const alert = state.alerts.find((a) => a.id === id);
  if (!alert || alert.resolved) return;
  mutate((s) =>
    applyAlertResolutionEffects(
      { ...s, alerts: s.alerts.map((a) => (a.id === id ? { ...a, resolved: true } : a)) },
      id
    )
  );
  if (alert.id === "a-backup-luthier") {
    prependActivity({
      actor: state.operator.name,
      avatarSeed: state.operator.avatarSeed,
      prefix: "Re-ran the failed backup for ",
      target: "Luthier's Guild",
      suffix: " — verified",
    });
  }
}

// ---------- backups ----------

export async function downloadBackup(
  instanceId: string,
  entryId?: string
): Promise<{ filename: string; contents: string } | null> {
  await latency();
  const inst = state.instances.find((i) => i.id === instanceId);
  if (!inst) return null;
  const entry = entryId
    ? inst.backups.entries.find((e) => e.id === entryId)
    : inst.backups.entries[0];
  const manifest = {
    instance: inst.id,
    composeProject: inst.dbName,
    domain: inst.domain,
    backup: entry ?? { label: inst.backups.lastRunAt, sizeMb: inst.backups.sizeMb },
    contents: ["pg_dump (postgres volume)", "uploads.tar.gz (uploads volume)"],
    note: "Mock manifest — the real endpoint streams the archive itself.",
  };
  return {
    filename: `${inst.dbName}-backup-${(entry?.id ?? "latest").replace(/^b-/, "")}.json`,
    contents: JSON.stringify(manifest, null, 2),
  };
}

const RESTORE_MS = 6000;

export async function restoreBackup(instanceId: string, entryId: string): Promise<void> {
  await latency();
  const inst = state.instances.find((i) => i.id === instanceId);
  if (!inst) return;
  const entry = inst.backups.entries.find((e) => e.id === entryId);
  const label = entry?.label ?? "latest backup";
  patchInstance(instanceId, (i) => ({ ...i, restoreInProgress: { entryLabel: label } }));
  prependActivity({
    actor: inst.owner,
    avatarSeed: "priya-av",
    prefix: "Started a restore of ",
    target: label,
    suffix: ` for ${inst.clientName}`,
  });
  setTimeout(() => {
    patchInstance(instanceId, (i) => ({ ...i, restoreInProgress: null }));
    prependActivity({
      actor: "Fleet monitor",
      avatarSeed: "fleet-bot",
      prefix: "Restore finished for ",
      target: inst.clientName,
      suffix: " — integrity check passed",
    });
  }, RESTORE_MS);
}

// ---------- tickets ----------

export async function createTicket(instanceId: string, subject: string): Promise<void> {
  await latency();
  const inst = state.instances.find((i) => i.id === instanceId);
  if (!inst) return;
  const nextId = Math.max(482, ...state.instances.flatMap((i) => i.tickets.map((t) => t.id))) + 1;
  const ticket: Ticket = {
    id: nextId,
    instanceId,
    subject,
    meta: `#${nextId} · just now · avg response 4h`,
    requester: inst.owner,
    status: "Open",
  };
  patchInstance(instanceId, (i) => ({ ...i, tickets: [ticket, ...i.tickets] }));
}

// ---------- mobile builds ----------

export async function requestMobileBuilds(
  instanceId: string,
  platforms: { ios: boolean; android: boolean }
): Promise<void> {
  await latency();
  const inst = state.instances.find((i) => i.id === instanceId);
  if (!inst) return;
  patchInstance(instanceId, (i) => ({
    ...i,
    mobileBuilds: {
      ios: platforms.ios
        ? { ...i.mobileBuilds.ios, status: "Building", detail: "build queued · just now" }
        : i.mobileBuilds.ios,
      android: platforms.android
        ? { ...i.mobileBuilds.android, status: "Building", detail: "build queued · just now" }
        : i.mobileBuilds.android,
    },
  }));
  prependActivity({
    actor: inst.owner,
    avatarSeed: "priya-av",
    prefix: "Requested mobile builds for ",
    target: inst.clientName,
    suffix: ` (${[platforms.ios && "iOS", platforms.android && "Android"].filter(Boolean).join(" + ")})`,
  });
}

// ---------- license / billing ----------

export async function changePlan(instanceId: string, plan: PlanTier): Promise<void> {
  await latency();
  const inst = state.instances.find((i) => i.id === instanceId);
  if (!inst || inst.plan === plan) return;
  const delta = PLAN_PRICE[plan] - inst.license.priceMonthly;
  patchInstance(instanceId, (i) => ({
    ...i,
    plan,
    mrr: PLAN_PRICE[plan],
    license: { ...i.license, plan, priceMonthly: PLAN_PRICE[plan], includes: PLAN_INCLUDES[plan] },
  }));
  mutate((s) => ({
    ...s,
    // Keep the owning self-serve account's license record in sync.
    clients: s.clients.map((c) =>
      c.instanceId === instanceId
        ? {
            ...c,
            plan,
            license: { ...c.license, plan, priceMonthly: PLAN_PRICE[plan], includes: PLAN_INCLUDES[plan] },
          }
        : c
    ),
    stats: { ...s.stats, mrr: s.stats.mrr + delta },
  }));
  prependActivity({
    actor: inst.owner,
    avatarSeed: "priya-av",
    prefix: "Changed the license for ",
    target: inst.clientName,
    suffix: ` to ${plan} ($${PLAN_PRICE[plan]}/mo)`,
  });
}

export async function updateCard(instanceId: string, brand: string, last4: string): Promise<void> {
  await latency();
  patchInstance(instanceId, (i) => ({
    ...i,
    license: { ...i.license, cardBrand: brand, cardLast4: last4 },
  }));
  mutate((s) => ({
    ...s,
    clients: s.clients.map((c) =>
      c.instanceId === instanceId
        ? { ...c, license: { ...c.license, cardBrand: brand, cardLast4: last4 } }
        : c
    ),
  }));
}

// ---------- hosts & settings ----------

export async function addHost(name: string, region: string): Promise<void> {
  await latency();
  mutate((s) => ({
    ...s,
    hosts: [...s.hosts, { name, region, instanceCount: 0, cpuPct: 2, memPct: 6, diskPct: 3 }],
  }));
  prependActivity({
    actor: state.operator.name,
    avatarSeed: state.operator.avatarSeed,
    prefix: "Added host ",
    target: name,
    suffix: ` (${region}) to the fleet`,
  });
}

export async function updateSettings(patch: Partial<OpsSettings>): Promise<void> {
  await latency();
  mutate((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
}

// ---------- UI state (mock-only; a real app would keep this in the page) ----------

export function setInstanceQuery(q: string): void {
  mutate((s) => ({ ...s, ui: { ...s.ui, instanceQuery: q } }));
}
