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
// DOMAIN MODEL (operator-controlled licensing):
//   Plan     — operator-defined catalog entry (price, instance cap, app
//              track, feature lines). CRUD from /operator/plans; the ACTIVE
//              set renders on the sales page, the signup wizard and the
//              portal upgrade dialog.
//   License  — one per client account; points at a plan and may carry
//              per-license overrides (instance cap, app track) plus an
//              active/suspended flag. effectiveCap()/effectiveTrack()
//              resolve override ?? plan value.
//   Instance — an isolated stack owned by a client (Instance.clientId).
//              A client may run up to effectiveCap(license) instances.
//
// SWAP PLAN — what replaces each function when the real control-plane
// service (LocalDockerDriver, later a cloud driver) lands:
//
//   getFleetState()      → aggregate of the GETs below (or a websocket snapshot)
//   provisionInstance()  → POST /fleet/instances {id, domain, planId, adminEmail}
//                          driver: mint unique secrets + allocate API/WEB/ADMIN
//                          ports, write deploy/instance/<id>.env, then
//                          `docker compose -p lms_<id> --env-file <id>.env
//                           -f docker-compose.instance.yml up -d`.
//                          Status stays "Provisioning" until the api /health
//                          check passes, then flips to "Running" — mocked
//                          here with a timer.
//   startInstance(id)    → POST /fleet/instances/:id/start   (compose start)
//   stopInstance(id)     → POST /fleet/instances/:id/stop    (compose stop)
//   destroyInstance(id)  → DELETE /fleet/instances/:id       (compose down -v)
//   suspendLicense()/resumeLicense() → POST /licenses/:clientId/(suspend|resume)
//   changeLicensePlan()  → POST /licenses/:clientId/plan {planId}
//   setLicenseCapOverride()/setLicenseTrackOverride()
//                        → PATCH /licenses/:clientId {instanceCapOverride|appTrackOverride}
//   createPlan()/updatePlan()/togglePlanActive()/reorderPlan()
//                        → CRUD on /plans (operator-only)
//   scheduleUpdate(id)   → POST /fleet/instances/:id/update {version, window:"tonight"}
//   pauseRollout()/resumeRollout() → POST /fleet/rollouts/current/(pause|resume)
//   listAlerts()/resolveAlert()    → GET /fleet/alerts · POST /fleet/alerts/:id/resolve
//   runBackup()/downloadBackup()/restoreBackup() → per-instance backup endpoints
//   createTicket()/requestMobileBuilds()/updateCard() → per-client endpoints
//   addHost()/updateSettings()     → fleet admin endpoints
//
// SELF-SERVE verbs (sales → signup → portal journey):
//   createClientAccount()  → POST /auth/signup  (account + license; billing
//                            provider charges the plan — mocked as the 4242 card)
//   provisionOwnInstance() → POST /portal/instances {name, domain} — same
//                            pipeline as the operator provision, quota-checked
//                            against effectiveCap(license).
//
// PERSISTENCE (preview-only): the whole mutable slice — plans, clients,
// instances, rollout, alerts, hosts, activity, stats, settings — is mirrored
// to localStorage ("lms.ops.store.v2"; v1 blobs are discarded silently) so
// operator edits and self-serve accounts survive reloads AND are visible to
// the sales/signup/portal surfaces in the same browser. Other browsers see
// the seed. A `storage` listener re-hydrates other open tabs live.
// ============================================================

import type {
  ActivityEntry,
  AppTrack,
  ClientAccount,
  FleetAlert,
  FleetState,
  FleetStats,
  Host,
  Instance,
  InstanceHealth,
  License,
  OpsSettings,
  Plan,
  ProvisionInput,
  Rollout,
  StatusPillInfo,
  Ticket,
  UsageQuota,
} from "./types";

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

// ---------- seed: plan catalog ----------

function seedPlans(): Plan[] {
  return [
    {
      id: "starter",
      name: "Starter",
      blurb: "For a first cohort",
      priceMonthly: 99,
      instanceCap: 1,
      appTrack: "none",
      features: [
        "1 instance · your domain",
        "Up to 500 members",
        "Web only (no mobile apps)",
        "Weekly backups",
        "Community support",
      ],
      featured: false,
      active: true,
      order: 0,
    },
    {
      id: "pro",
      name: "Pro",
      blurb: "For a growing academy",
      priceMonthly: 249,
      instanceCap: 1,
      appTrack: "shared",
      features: [
        "1 instance · your domain",
        "Up to 5,000 members",
        "iOS & Android via the shared Spotlight app",
        "Daily backups + restore drills",
        "Live sessions & certificates",
        "Priority support (4h)",
      ],
      featured: true,
      active: true,
      order: 1,
    },
    {
      id: "scale",
      name: "Scale",
      blurb: "For schools & networks",
      priceMonthly: 599,
      instanceCap: 3,
      appTrack: "whitelabel",
      features: [
        "Up to 3 instances",
        "Unlimited members",
        "White-label apps on your store accounts",
        "Dedicated host & SLA 99.9%",
        "Hourly backups",
        "White-glove migration",
      ],
      featured: false,
      active: true,
      order: 2,
    },
  ];
}

/** Fresh copy of the seed catalog — pre-hydration fallback for public pages. */
export function getSeededPlans(): Plan[] {
  return seedPlans();
}

// ---------- seed: fleet ----------

function baseInstance(
  partial: Pick<Instance, "id" | "clientId" | "clientName" | "domain"> & Partial<Instance>
): Instance {
  return {
    dbName: `lms_${partial.id}`,
    ports: { api: 8010, web: 8011, admin: 8012 },
    urls: urlsFor(partial.domain),
    version: "v1.8.1",
    health: HEALTHY,
    membersCount: 0,
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
    tickets: [],
    usage: [],
    metrics: null,
    owner: "—",
    restoreInProgress: null,
    ...partial,
  };
}

function seedClient(
  partial: Pick<ClientAccount, "id" | "name" | "academyName" | "email" | "createdAt"> &
    Partial<ClientAccount> & { license: License }
): ClientAccount {
  return {
    avatarSeed: `client-${partial.id}`,
    ...partial,
  };
}

function seedState(): FleetState {
  const instances: Instance[] = [
    baseInstance({
      id: "spotlight",
      clientId: "spotlight",
      clientName: "Spotlight Academy",
      domain: "spotlightacademy.com",
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
      clientId: "codecraft",
      clientName: "CodeCraft Bootcamp",
      domain: "codecraft.io",
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
      mobileBuilds: {
        ios: { status: "Live", version: "v1.3", detail: "App Store · 640 installs" },
        android: { status: "Live", version: "v1.3", detail: "Google Play · 890 installs" },
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
      clientId: "harbor",
      clientName: "Harbor Yoga School",
      domain: "harboryoga.com",
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
      clientId: "luthier",
      clientName: "Luthier's Guild",
      domain: "luthiersguild.com",
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
      clientId: "bright",
      clientName: "Bright Kitchen Co",
      domain: "brightkitchen.co",
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
      clientId: "northstar",
      clientName: "Northstar Pilates",
      domain: "northstarpilates.com",
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
    }),
  ];

  // Every instance has an owning license holder — the seeded fleet maps to
  // synthetic client records so per-client caps and counts always resolve.
  const clients: ClientAccount[] = [
    seedClient({
      id: "spotlight",
      name: "Ava Chen",
      academyName: "Spotlight Academy",
      email: "ava@spotlightacademy.com",
      createdAt: "2025-11-02",
      license: {
        planId: "pro",
        status: "active",
        renewsAt: "Nov 2, 2026",
        cardBrand: "Visa",
        cardLast4: "5031",
      },
    }),
    seedClient({
      id: "codecraft",
      name: "Jonah Park",
      academyName: "CodeCraft Bootcamp",
      email: "jonah@codecraft.io",
      createdAt: "2025-09-18",
      license: {
        planId: "scale",
        status: "active",
        renewsAt: "Sep 18, 2026",
        cardBrand: "Amex",
        cardLast4: "1006",
      },
    }),
    seedClient({
      id: "harbor",
      name: "Priya Sharma",
      academyName: "Harbor Yoga School",
      email: "priya@harboryoga.com",
      createdAt: "2026-02-12",
      avatarSeed: "priya-av",
      license: {
        planId: "pro",
        status: "active",
        renewsAt: "Aug 12, 2026",
        cardBrand: "Visa",
        cardLast4: "4242",
      },
    }),
    seedClient({
      id: "luthier",
      name: "Sam Osei",
      academyName: "Luthier's Guild",
      email: "sam@luthiersguild.com",
      createdAt: "2026-03-30",
      license: {
        planId: "starter",
        status: "active",
        renewsAt: "Jul 30, 2026",
        cardBrand: "Mastercard",
        cardLast4: "7719",
      },
    }),
    seedClient({
      id: "bright",
      name: "Dana Whitfield",
      academyName: "Bright Kitchen Co",
      email: "dana@brightkitchen.co",
      createdAt: "2026-07-06",
      license: {
        planId: "pro",
        status: "active",
        renewsAt: "Aug 6, 2026",
        cardBrand: "Visa",
        cardLast4: "8817",
      },
    }),
    seedClient({
      id: "northstar",
      name: "Noah Berg",
      academyName: "Northstar Pilates",
      email: "noah@northstarpilates.com",
      createdAt: "2025-12-08",
      license: {
        planId: "starter",
        status: "suspended",
        renewsAt: "lapsed Jun 30",
        cardBrand: "Visa",
        cardLast4: "0341",
      },
    }),
  ];

  return {
    plans: seedPlans(),
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
        prefix: "Suspended the license for ",
        target: "Northstar Pilates",
        suffix: " — lapsed Jun 30",
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

/** Versioned persistence key — v1 blobs are discarded silently. */
const STORE_KEY = "lms.ops.store.v2";
const LEGACY_KEYS = ["lms.ops.store.v1"];

/** How long a mock provision takes before the /health checks "pass". */
const PROVISION_BOOT_MS = 8000;

// Seed instance ids — their in-flight demo states (e.g. bright, forever
// "Provisioning") are NOT re-armed as real boots on reload.
const SEED_INSTANCE_IDS = new Set(seedState().instances.map((i) => i.id));

/**
 * The persisted slice — the ENTIRE mutable store (not just user-created
 * records), so operator actions against seeded records (plan edits, license
 * overrides, suspends, stops) survive reloads too.
 */
interface PersistedStoreV2 {
  v: 2;
  plans: Plan[];
  clients: ClientAccount[];
  instances: Instance[];
  rollout: Rollout;
  alerts: FleetAlert[];
  hosts: Host[];
  activity: ActivityEntry[];
  stats: FleetStats;
  settings: OpsSettings;
}

function readPersisted(): PersistedStoreV2 | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    for (const key of LEGACY_KEYS) window.localStorage.removeItem(key);
    raw = window.localStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const blob = JSON.parse(raw) as Partial<PersistedStoreV2> | null;
    const valid =
      !!blob &&
      blob.v === 2 &&
      Array.isArray(blob.plans) &&
      blob.plans.length > 0 &&
      Array.isArray(blob.clients) &&
      Array.isArray(blob.instances) &&
      Array.isArray(blob.alerts) &&
      Array.isArray(blob.hosts) &&
      Array.isArray(blob.activity) &&
      !!blob.rollout &&
      !!blob.settings &&
      typeof blob.stats?.licenses === "number" &&
      typeof blob.stats?.running === "number" &&
      typeof blob.stats?.mrr === "number";
    if (!valid) {
      window.localStorage.removeItem(STORE_KEY);
      return null;
    }
    return blob as PersistedStoreV2;
  } catch {
    try {
      window.localStorage.removeItem(STORE_KEY);
    } catch {
      // ignore
    }
    return null;
  }
}

/** Seed is the base; a valid persisted blob replaces the mutable slice wholesale. */
function hydrateState(): FleetState {
  const seed = seedState();
  const saved = readPersisted();
  if (!saved) return seed;
  return {
    ...seed,
    plans: saved.plans,
    clients: saved.clients,
    // A restore timer never survives a reload — clear the in-progress flag.
    instances: saved.instances.map((i) => (i.restoreInProgress ? { ...i, restoreInProgress: null } : i)),
    rollout: saved.rollout,
    alerts: saved.alerts,
    hosts: saved.hosts,
    activity: saved.activity,
    stats: saved.stats,
    settings: saved.settings,
  };
}

function persistStore(): void {
  if (typeof window === "undefined") return;
  try {
    const slice: PersistedStoreV2 = {
      v: 2,
      plans: state.plans,
      clients: state.clients,
      instances: state.instances,
      rollout: state.rollout,
      alerts: state.alerts,
      hosts: state.hosts,
      activity: state.activity,
      stats: state.stats,
      settings: state.settings,
    };
    window.localStorage.setItem(STORE_KEY, JSON.stringify(slice));
  } catch {
    // Private mode / quota exceeded — persistence is best-effort in the preview.
  }
}

let state: FleetState = hydrateState();
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  // Re-arm boots that were persisted mid-provision: the flip to Running would
  // otherwise be lost with the reloaded timer. Seeded demo states are skipped.
  for (const inst of state.instances) {
    if (!SEED_INSTANCE_IDS.has(inst.id) && inst.status === "Provisioning") {
      scheduleBootCompletion(inst.id);
    }
  }
  // Live cross-tab sync: a write in another tab (e.g. operator console beside
  // a client portal) re-hydrates this tab without persisting back.
  window.addEventListener("storage", (e) => {
    if (e.key !== STORE_KEY) return;
    state = hydrateState();
    listeners.forEach((fn) => fn());
  });
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

function patchLicense(clientId: string, patch: (l: License) => License) {
  mutate((s) => ({
    ...s,
    clients: s.clients.map((c) => (c.id === clientId ? { ...c, license: patch(c.license) } : c)),
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

export async function listTickets(): Promise<Ticket[]> {
  await latency();
  return state.instances.flatMap((i) => i.tickets);
}

// ---------- plan catalog helpers (pure) ----------

export function getPlan(s: FleetState, planId: string): Plan | undefined {
  return s.plans.find((p) => p.id === planId);
}

export function planName(s: FleetState, planId: string): string {
  return getPlan(s, planId)?.name ?? planId;
}

export function planPrice(s: FleetState, planId: string): number {
  return getPlan(s, planId)?.priceMonthly ?? 0;
}

/** All plans, sorted by their operator-set order. */
export function sortedPlans(s: FleetState): Plan[] {
  return [...s.plans].sort((a, b) => a.order - b.order);
}

/** The sellable set — what sales, signup and the upgrade dialog render. */
export function activePlans(s: FleetState): Plan[] {
  return sortedPlans(s).filter((p) => p.active);
}

/** How many instances this license may run — override ?? plan cap. */
export function effectiveCap(s: FleetState, license: License): number {
  if (typeof license.instanceCapOverride === "number") return license.instanceCapOverride;
  return getPlan(s, license.planId)?.instanceCap ?? 1;
}

/** Which app track this license is on — override ?? plan track. */
export function effectiveTrack(s: FleetState, license: License): AppTrack {
  return license.appTrackOverride ?? getPlan(s, license.planId)?.appTrack ?? "none";
}

export function trackLabel(track: AppTrack): string {
  if (track === "shared") return "Shared app";
  if (track === "whitelabel") return "White-label";
  return "Web only";
}

/** Longer chip copy used on sales/signup tier cards. */
export function trackChipLabel(track: AppTrack): string {
  if (track === "shared") return "Shared app included";
  if (track === "whitelabel") return "White-label apps included";
  return "Web only";
}

export function clientsOnPlan(s: FleetState, planId: string): number {
  return s.clients.filter((c) => c.license.planId === planId).length;
}

/** "Includes …" one-liner for license cards. */
export function licenseSummary(s: FleetState, license: License): string {
  const cap = effectiveCap(s, license);
  return `${cap} instance${cap === 1 ? "" : "s"} · ${trackLabel(effectiveTrack(s, license))}`;
}

// ---------- client/instance helpers (pure) ----------

/** All instances owned by a client's license, oldest first. */
export function clientInstances(s: FleetState, clientId: string): Instance[] {
  return s.instances.filter((i) => i.clientId === clientId);
}

export function clientForInstance(s: FleetState, instance: Instance): ClientAccount | undefined {
  return s.clients.find((c) => c.id === instance.clientId);
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

/** Resolves a client session (demo or real) to its account record. */
export function portalClient(
  s: FleetState,
  session: { clientId: string } | null | undefined
): ClientAccount | undefined {
  if (!session) return undefined;
  return s.clients.find((c) => c.id === session.clientId);
}

/** Sync check for the provision forms — instance ids are compose projects. */
export function instanceIdTaken(id: string): boolean {
  return state.instances.some((i) => i.id === id);
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

/**
 * Honest uptime copy: "—" while provisioning/down, "uptime 100% since Jul 6"
 * until an instance has 30 days of history, then the usual 30-day window.
 */
export function uptimeLabel(i: Instance): string {
  if (i.uptimePct === null || i.status === "Provisioning") return "uptime —";
  const created = new Date(`${i.createdAt}T00:00:00`);
  const ageDays = (Date.now() - created.getTime()) / 86_400_000;
  if (Number.isFinite(ageDays) && ageDays < 30) {
    const since = created.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `uptime ${i.uptimePct}% since ${since}`;
  }
  return `uptime ${i.uptimePct}% (30d)`;
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

/** Open tickets across every instance a client owns. */
export function openTicketCountForClient(s: FleetState, clientId: string): number {
  return clientInstances(s, clientId)
    .flatMap((i) => i.tickets)
    .filter((t) => t.status === "Open").length;
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
function zeroUsage(plan: Plan | undefined): UsageQuota[] {
  const memberLine = plan?.features.find((f) => /member/i.test(f)) ?? "";
  const capMatch = memberLine.match(/up to ([\d,]+)/i);
  const members = capMatch ? `of ${capMatch[1]}` : /unlimited/i.test(memberLine) ? "unlimited" : "plan limit";
  return [
    { name: "Members", value: "0", limitNote: members, pct: 0 },
    { name: "Storage", value: "0.0 GB", limitNote: "of 50 GB", pct: 0 },
    { name: "Video minutes", value: "0", limitNote: "of 2,000 / mo", pct: 0 },
    { name: "Visits (30d)", value: "0", limitNote: "bandwidth 0%", pct: 0 },
  ];
}

// ---------- boot completion (shared by operator + self-serve provisions) ----------

function leastLoadedHost(s: FleetState): Host {
  const sorted = [...s.hosts].sort((a, b) => a.instanceCount - b.instanceCount);
  return sorted[0] ?? { name: "vps-1", region: "Frankfurt", instanceCount: 0, cpuPct: 0, memPct: 0, diskPct: 0 };
}

/**
 * Mock of the /health poll: flips Provisioning → Running once the boot
 * sequence (migrate deploy + seed) would have finished, places the instance
 * on the least-loaded host, and bumps the running count. The license/MRR were
 * already counted when the license was created (signup or operator provision).
 */
function completeBoot(id: string): void {
  const inst = state.instances.find((i) => i.id === id);
  if (!inst || inst.status !== "Provisioning") return;
  const owningClient = state.clients.find((c) => c.id === inst.clientId);
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
    stats: { ...s.stats, running: s.stats.running + 1 },
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

/** Shared instance factory for both provisioning paths. */
function buildProvisioningInstance(input: {
  id: string;
  clientId: string;
  clientName: string;
  domain: string;
  owner: string;
  usage?: UsageQuota[];
}): Instance {
  const base = nextPortBase(state);
  return baseInstance({
    id: input.id,
    clientId: input.clientId,
    clientName: input.clientName,
    domain: input.domain,
    ports: { api: base, web: base + 1, admin: base + 2 },
    version: state.rollout.targetVersion,
    health: UNKNOWN_HEALTH,
    membersCount: null,
    status: "Provisioning",
    uptimePct: null,
    createdAt: new Date().toISOString().slice(0, 10),
    owner: input.owner,
    usage: input.usage ?? [],
    backups: {
      schedule: "Daily · 02:00",
      lastRunAt: "—",
      verified: false,
      sizeMb: 0,
      retentionNote: "First backup runs tonight at 02:00",
      entries: [],
    },
  });
}

// ---------- operator provisioning (creates a client + license + instance) ----------

export type ProvisionResult = { ok: true; instance: Instance } | { ok: false; error: string };

/**
 * Operator "+ Provision instance": brings up a stack for a NEW license
 * holder — creates the client account + license (counted into stats/MRR
 * immediately, like a signup) and boots the instance.
 */
export async function provisionInstance(input: ProvisionInput): Promise<ProvisionResult> {
  await latency();
  const id = input.id.trim().toLowerCase();
  if (state.instances.some((i) => i.id === id)) {
    return { ok: false, error: `Instance id "${id}" is already taken.` };
  }
  const plan = getPlan(state, input.planId);
  if (!plan) return { ok: false, error: "Pick a plan from the catalog." };

  const clientName = clientNameFromId(id);
  const email = input.adminEmail.trim().toLowerCase();
  const ownerName =
    clientNameFromId(slugify(email.split("@")[0] ?? "")) || clientName;
  const clientId = uniqueId(id, (candidate) => state.clients.some((c) => c.id === candidate));
  const client: ClientAccount = {
    id: clientId,
    name: ownerName,
    academyName: clientName,
    email,
    createdAt: new Date().toISOString().slice(0, 10),
    avatarSeed: `client-${clientId}`,
    license: {
      planId: plan.id,
      status: "active",
      renewsAt: renewalDateLabel(),
      cardBrand: "Visa",
      cardLast4: "4242",
    },
  };
  const inst = buildProvisioningInstance({
    id,
    clientId,
    clientName,
    domain: input.domain.trim().toLowerCase(),
    owner: email,
    usage: zeroUsage(plan),
  });

  mutate((s) => ({
    ...s,
    clients: [...s.clients, client],
    instances: [...s.instances, inst],
    stats: {
      ...s.stats,
      licenses: s.stats.licenses + 1,
      mrr: s.stats.mrr + plan.priceMonthly,
    },
  }));
  prependActivity({
    actor: state.operator.name,
    avatarSeed: state.operator.avatarSeed,
    prefix: "Provisioned ",
    target: clientName,
    suffix: ` (${plan.name}) — boot in progress`,
  });
  scheduleBootCompletion(id);

  return { ok: true, instance: inst };
}

// ---------- self-serve accounts & provisioning (sales → signup → portal) ----------

export interface CreateClientInput {
  name: string;
  academyName: string;
  email: string;
  planId: string;
}

export type CreateClientResult =
  | { ok: true; client: ClientAccount }
  | { ok: false; error: string };

/**
 * Self-serve purchase: creates the client account + license records and
 * counts the new license into the fleet stats/MRR, so the operator console
 * shows the signup immediately. Instances are provisioned separately from
 * the portal (provisionOwnInstance), up to effectiveCap(license).
 */
export async function createClientAccount(input: CreateClientInput): Promise<CreateClientResult> {
  await latency();
  const email = input.email.trim().toLowerCase();
  if (findClientByEmail(email)) {
    return { ok: false, error: "An academy is already registered to that email — sign in instead." };
  }
  const plan = getPlan(state, input.planId);
  if (!plan || !plan.active) {
    return { ok: false, error: "That plan is no longer available — pick another." };
  }
  const id = uniqueId(
    slugify(input.academyName),
    (candidate) =>
      state.clients.some((c) => c.id === candidate) || state.instances.some((i) => i.id === candidate)
  );
  const client: ClientAccount = {
    id,
    name: input.name.trim(),
    academyName: input.academyName.trim(),
    email,
    createdAt: new Date().toISOString().slice(0, 10),
    avatarSeed: `client-${id}`,
    license: {
      planId: plan.id,
      status: "active",
      renewsAt: renewalDateLabel(),
      cardBrand: "Visa",
      cardLast4: "4242",
    },
  };
  mutate((s) => ({
    ...s,
    clients: [...s.clients, client],
    stats: { ...s.stats, licenses: s.stats.licenses + 1, mrr: s.stats.mrr + plan.priceMonthly },
  }));
  prependActivity({
    actor: client.name,
    avatarSeed: client.avatarSeed,
    prefix: "New license — ",
    target: client.academyName,
    suffix: ` (${plan.name}) · self-serve`,
  });
  return { ok: true, client };
}

/**
 * Portal onboarding + "Provision another instance": brings up an instance on
 * the client's license — same pipeline as the operator provision. Quota- and
 * suspension-checked against the license (the UI hides the forms too; this is
 * the backstop).
 */
export async function provisionOwnInstance(
  clientId: string,
  input: { name: string; domain: string },
  by: "client" | "operator" = "client"
): Promise<ProvisionResult> {
  await latency();
  const client = state.clients.find((c) => c.id === clientId);
  if (!client) return { ok: false, error: "Account not found." };
  if (client.license.status === "suspended") {
    return { ok: false, error: "License suspended — provisioning is disabled. Contact support." };
  }
  const owned = clientInstances(state, clientId);
  const cap = effectiveCap(state, client.license);
  if (owned.length >= cap) {
    return {
      ok: false,
      error: `Instance limit reached — ${owned.length} of ${cap} used. Upgrade the plan or raise the cap.`,
    };
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
  const inst = buildProvisioningInstance({
    id,
    clientId,
    clientName: academyName,
    domain,
    owner: client.name,
    usage: zeroUsage(getPlan(state, client.license.planId)),
  });

  mutate((s) => ({
    ...s,
    instances: [...s.instances, inst],
    // The first provision names the academy; later instances have their own names.
    clients:
      owned.length === 0
        ? s.clients.map((c) => (c.id === clientId ? { ...c, academyName } : c))
        : s.clients,
  }));
  prependActivity(
    by === "operator"
      ? {
          actor: state.operator.name,
          avatarSeed: state.operator.avatarSeed,
          prefix: "Provisioned ",
          target: academyName,
          suffix: ` for ${client.academyName} — boot in progress`,
        }
      : {
          actor: client.name,
          avatarSeed: client.avatarSeed,
          prefix: "Provisioned ",
          target: academyName,
          suffix: ` (${owned.length + 1} of ${cap}) — self-serve, boot in progress`,
        }
  );
  scheduleBootCompletion(id);

  return { ok: true, instance: inst };
}

// ---------- instance lifecycle (containers only — the license is separate) ----------

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
  const wasRunning = inst.status === "Running";
  patchInstance(id, (i) => ({ ...i, status: "Stopped", health: UNKNOWN_HEALTH, uptimePct: null }));
  mutate((s) => ({
    ...s,
    stats: { ...s.stats, running: wasRunning ? Math.max(0, s.stats.running - 1) : s.stats.running },
  }));
  prependActivity({
    actor: state.operator.name,
    avatarSeed: state.operator.avatarSeed,
    prefix: "Stopped ",
    target: inst.clientName,
    suffix: " — containers down, volumes kept",
  });
}

/** compose down -v — removes containers AND data volumes. The license stays. */
export async function destroyInstance(id: string): Promise<void> {
  await latency();
  const inst = state.instances.find((i) => i.id === id);
  if (!inst) return;
  const wasRunning = inst.status === "Running";
  const hostName = inst.metrics?.host;
  mutate((s) => ({
    ...s,
    instances: s.instances.filter((i) => i.id !== id),
    hosts: hostName
      ? s.hosts.map((h) =>
          h.name === hostName ? { ...h, instanceCount: Math.max(0, h.instanceCount - 1) } : h
        )
      : s.hosts,
    stats: {
      ...s.stats,
      running: wasRunning ? Math.max(0, s.stats.running - 1) : s.stats.running,
    },
  }));
  prependActivity({
    actor: state.operator.name,
    avatarSeed: state.operator.avatarSeed,
    prefix: "Destroyed ",
    target: inst.clientName,
    suffix: " — compose down -v, volumes purged; the license keeps its slot",
  });
}

// ---------- license control (operator) ----------

/**
 * Suspends the LICENSE: the client portal shows a warning banner and every
 * mutating action is disabled; instances keep running. MRR drops by the
 * plan price.
 */
export async function suspendLicense(clientId: string): Promise<void> {
  await latency();
  const client = state.clients.find((c) => c.id === clientId);
  if (!client || client.license.status === "suspended") return;
  const price = planPrice(state, client.license.planId);
  patchLicense(clientId, (l) => ({ ...l, status: "suspended" }));
  mutate((s) => ({ ...s, stats: { ...s.stats, mrr: Math.max(0, s.stats.mrr - price) } }));
  prependActivity({
    actor: state.operator.name,
    avatarSeed: state.operator.avatarSeed,
    prefix: "Suspended the license for ",
    target: client.academyName,
    suffix: " — portal actions disabled, instances keep running",
  });
}

/**
 * Resumes the license (MRR back on). Any instance that was parked in the
 * seeded "Suspended" state comes back up with it.
 */
export async function resumeLicense(clientId: string): Promise<void> {
  await latency();
  const client = state.clients.find((c) => c.id === clientId);
  if (!client || client.license.status === "active") return;
  const price = planPrice(state, client.license.planId);
  const revived = clientInstances(state, clientId).filter((i) => i.status === "Suspended");
  mutate((s) => ({
    ...s,
    clients: s.clients.map((c) =>
      c.id === clientId
        ? { ...c, license: { ...c.license, status: "active", renewsAt: renewalDateLabel() } }
        : c
    ),
    instances: s.instances.map((i) =>
      i.clientId === clientId && i.status === "Suspended"
        ? { ...i, status: "Running", health: HEALTHY, uptimePct: 99.9 }
        : i
    ),
    stats: {
      ...s.stats,
      running: s.stats.running + revived.length,
      mrr: s.stats.mrr + price,
    },
  }));
  prependActivity({
    actor: state.operator.name,
    avatarSeed: state.operator.avatarSeed,
    prefix: "Resumed the license for ",
    target: client.academyName,
    suffix: revived.length > 0 ? " — parked instances restarted" : "",
  });
}

/**
 * Moves the license to another catalog plan — MRR repriced, cap/track follow
 * the new plan (per-license overrides stay). Called from the operator console
 * and the portal Upgrade dialog.
 */
export async function changeLicensePlan(
  clientId: string,
  planId: string,
  by: "operator" | "client" = "client"
): Promise<void> {
  await latency();
  const client = state.clients.find((c) => c.id === clientId);
  const plan = getPlan(state, planId);
  if (!client || !plan || client.license.planId === planId) return;
  const oldPrice = planPrice(state, client.license.planId);
  const delta = client.license.status === "active" ? plan.priceMonthly - oldPrice : 0;
  mutate((s) => ({
    ...s,
    clients: s.clients.map((c) =>
      c.id === clientId ? { ...c, license: { ...c.license, planId } } : c
    ),
    stats: { ...s.stats, mrr: Math.max(0, s.stats.mrr + delta) },
  }));
  prependActivity({
    actor: by === "operator" ? state.operator.name : client.name,
    avatarSeed: by === "operator" ? state.operator.avatarSeed : client.avatarSeed,
    prefix: "Changed the license for ",
    target: client.academyName,
    suffix: ` to ${plan.name} ($${plan.priceMonthly}/mo)`,
  });
}

/** Operator override of the instance cap; null clears back to the plan value. */
export async function setLicenseCapOverride(clientId: string, cap: number | null): Promise<void> {
  await latency();
  const client = state.clients.find((c) => c.id === clientId);
  if (!client) return;
  const before = effectiveCap(state, client.license);
  patchLicense(clientId, (l) => ({ ...l, instanceCapOverride: cap }));
  const after = effectiveCap(state, state.clients.find((c) => c.id === clientId)!.license);
  prependActivity({
    actor: state.operator.name,
    avatarSeed: state.operator.avatarSeed,
    prefix: cap === null ? "Cleared the instance-cap override for " : "Overrode the instance cap for ",
    target: client.academyName,
    suffix: ` — ${before} → ${after}${cap === null ? " (plan default)" : ""}`,
  });
}

/** Operator override of the app track; null clears back to the plan value. */
export async function setLicenseTrackOverride(clientId: string, track: AppTrack | null): Promise<void> {
  await latency();
  const client = state.clients.find((c) => c.id === clientId);
  if (!client) return;
  const before = trackLabel(effectiveTrack(state, client.license));
  patchLicense(clientId, (l) => ({ ...l, appTrackOverride: track }));
  const after = trackLabel(effectiveTrack(state, state.clients.find((c) => c.id === clientId)!.license));
  prependActivity({
    actor: state.operator.name,
    avatarSeed: state.operator.avatarSeed,
    prefix: "Switched the app track for ",
    target: client.academyName,
    suffix: ` — ${before} → ${after}${track === null ? " (plan default)" : ""}`,
  });
}

export async function updateCard(clientId: string, brand: string, last4: string): Promise<void> {
  await latency();
  patchLicense(clientId, (l) => ({ ...l, cardBrand: brand, cardLast4: last4 }));
}

// ---------- plan catalog CRUD (operator) ----------

export interface PlanInput {
  name: string;
  blurb: string;
  priceMonthly: number;
  instanceCap: number;
  appTrack: AppTrack;
  features: string[];
  featured: boolean;
}

export async function createPlan(input: PlanInput): Promise<Plan> {
  await latency();
  const id = uniqueId(slugify(input.name) || "plan", (candidate) =>
    state.plans.some((p) => p.id === candidate)
  );
  const plan: Plan = {
    id,
    ...input,
    active: true,
    order: Math.max(-1, ...state.plans.map((p) => p.order)) + 1,
  };
  mutate((s) => ({ ...s, plans: [...s.plans, plan] }));
  prependActivity({
    actor: state.operator.name,
    avatarSeed: state.operator.avatarSeed,
    prefix: "Created plan ",
    target: plan.name,
    suffix: ` — $${plan.priceMonthly}/mo · cap ${plan.instanceCap} · ${trackLabel(plan.appTrack)}`,
  });
  return plan;
}

export async function updatePlan(planId: string, patch: PlanInput): Promise<void> {
  await latency();
  const before = state.plans.find((p) => p.id === planId);
  if (!before) return;

  // Live catalog repricing: active licenses on this plan follow the new price.
  const priceDelta = patch.priceMonthly - before.priceMonthly;
  const activeLicenses = state.clients.filter(
    (c) => c.license.planId === planId && c.license.status === "active"
  ).length;

  const changes: string[] = [];
  if (before.name !== patch.name) changes.push(`renamed ${before.name} → ${patch.name}`);
  if (priceDelta !== 0) changes.push(`$${before.priceMonthly} → $${patch.priceMonthly}`);
  if (before.instanceCap !== patch.instanceCap)
    changes.push(`cap ${before.instanceCap} → ${patch.instanceCap}`);
  if (before.appTrack !== patch.appTrack)
    changes.push(`${trackLabel(before.appTrack)} → ${trackLabel(patch.appTrack)}`);
  if (before.featured !== patch.featured) changes.push(patch.featured ? "featured" : "unfeatured");
  if (
    before.blurb !== patch.blurb ||
    before.features.join("\n") !== patch.features.join("\n")
  )
    changes.push("copy updated");

  mutate((s) => ({
    ...s,
    plans: s.plans.map((p) => (p.id === planId ? { ...p, ...patch } : p)),
    stats: { ...s.stats, mrr: Math.max(0, s.stats.mrr + priceDelta * activeLicenses) },
  }));
  prependActivity({
    actor: state.operator.name,
    avatarSeed: state.operator.avatarSeed,
    prefix: "Plan updated — ",
    target: patch.name,
    suffix: changes.length > 0 ? `: ${changes.join(" · ")}` : ": no changes",
  });
}

export async function togglePlanActive(planId: string): Promise<void> {
  await latency();
  const plan = state.plans.find((p) => p.id === planId);
  if (!plan) return;
  mutate((s) => ({
    ...s,
    plans: s.plans.map((p) => (p.id === planId ? { ...p, active: !p.active } : p)),
  }));
  prependActivity({
    actor: state.operator.name,
    avatarSeed: state.operator.avatarSeed,
    prefix: plan.active ? "Deactivated plan " : "Activated plan ",
    target: plan.name,
    suffix: plan.active ? " — hidden from sales & signup, licenses keep it" : " — back on sale",
  });
}

/** Moves a plan up (-1) or down (+1) in every plan list. */
export async function reorderPlan(planId: string, direction: -1 | 1): Promise<void> {
  await latency();
  const ordered = sortedPlans(state);
  const idx = ordered.findIndex((p) => p.id === planId);
  const swapWith = ordered[idx + direction];
  if (idx === -1 || !swapWith) return;
  const a = ordered[idx];
  mutate((s) => ({
    ...s,
    plans: s.plans.map((p) =>
      p.id === a.id ? { ...p, order: swapWith.order } : p.id === swapWith.id ? { ...p, order: a.order } : p
    ),
  }));
}

// ---------- updates & rollout ----------

export async function scheduleUpdate(id: string): Promise<void> {
  await latency();
  const inst = state.instances.find((i) => i.id === id);
  if (!inst || !inst.updateAvailable) return;
  const owner = clientForInstance(state, inst);
  patchInstance(id, (i) => ({ ...i, updateScheduled: true }));
  prependActivity({
    actor: owner?.name ?? inst.owner,
    avatarSeed: owner?.avatarSeed ?? "fleet-bot",
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

/** Side effects mirroring what the real resolution action would do. */
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
  const owner = clientForInstance(state, inst);
  const entry = inst.backups.entries.find((e) => e.id === entryId);
  const label = entry?.label ?? "latest backup";
  patchInstance(instanceId, (i) => ({ ...i, restoreInProgress: { entryLabel: label } }));
  prependActivity({
    actor: owner?.name ?? inst.owner,
    avatarSeed: owner?.avatarSeed ?? "fleet-bot",
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
  const owner = clientForInstance(state, inst);
  const nextId = Math.max(482, ...state.instances.flatMap((i) => i.tickets.map((t) => t.id))) + 1;
  const ticket: Ticket = {
    id: nextId,
    instanceId,
    subject,
    meta: `#${nextId} · just now · avg response 4h`,
    requester: owner?.name ?? inst.owner,
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
  const owner = clientForInstance(state, inst);
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
    actor: owner?.name ?? inst.owner,
    avatarSeed: owner?.avatarSeed ?? "fleet-bot",
    prefix: "Requested mobile builds for ",
    target: inst.clientName,
    suffix: ` (${[platforms.ios && "iOS", platforms.android && "Android"].filter(Boolean).join(" + ")})`,
  });
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
