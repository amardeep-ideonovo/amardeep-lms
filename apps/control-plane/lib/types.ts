// ============================================================
// Control-plane (Spotlight Ops) — UI-only fleet/provisioner types.
//
// These mirror the real per-instance model in deploy/instance/
// (docker-compose.instance.yml + .env.instance.example):
//   - one fully isolated stack per client license, compose project
//     "lms_<id>" namespacing containers + pg/redis/uploads volumes
//   - distinct published host ports per instance (API/WEB/ADMIN)
//   - unique secrets + a seeded first admin on first boot
//   - lifecycle verbs: provision (up -d), start, stop, down, down -v
//   - healthchecks: api /health, pg_isready, redis ping
//
// Do NOT import from packages/types — these are local to the app.
// ============================================================

export type PlanTier = "Starter" | "Pro" | "Scale";

export type InstanceStatus =
  | "Running"
  | "Provisioning"
  | "Suspended"
  | "Stopped"
  | "Failed";

/** Per-service state, mirroring the compose healthchecks. */
export type ServiceState = "ok" | "warn" | "down" | "unknown";

export type HealthTone = "ok" | "warn" | "danger" | "none";

export interface InstanceHealth {
  api: ServiceState;
  web: ServiceState;
  admin: ServiceState;
  db: ServiceState;
  /** ISO timestamp of the last fleet health sweep. */
  lastCheck: string;
  /** Display label derived by the fleet monitor ("Healthy", "High CPU", "Backup failed", "—"). */
  label: string;
  tone: HealthTone;
}

/** Published host ports — allocated by the provisioner, unique per host. */
export interface InstancePorts {
  api: number;
  web: number;
  admin: number;
}

export interface InstanceUrls {
  api: string;
  web: string;
  admin: string;
}

export interface BackupEntry {
  id: string;
  /** e.g. "Today, 02:00 — DB + uploads" */
  label: string;
  /** e.g. "412 members · 2.1 GB · verified" */
  detail: string;
  sizeMb: number;
  verified: boolean;
  at: string;
}

export interface InstanceBackups {
  /** e.g. "Daily · 02:00" */
  schedule: string;
  lastRunAt: string;
  verified: boolean;
  sizeMb: number;
  entries: BackupEntry[];
  /** Retention/mirror note, e.g. "30 daily copies kept · off-server mirror on" */
  retentionNote: string;
}

export type MobileBuildStatus = "Live" | "In review" | "Building" | "—";

export interface MobileBuild {
  status: MobileBuildStatus;
  version: string;
  /** e.g. "submitted Jul 3 · App Store" / "Google Play · 1,208 installs" */
  detail: string;
}

export interface InstanceLicense {
  plan: PlanTier;
  priceMonthly: number;
  /** Display date, e.g. "Aug 12, 2026" */
  renewsAt: string;
  cardBrand: string;
  cardLast4: string;
  /** e.g. "1 instance, 5,000 members, mobile apps, daily backups" */
  includes: string;
}

/**
 * A self-serve client account (license holder). Created on /signup; the
 * license exists from purchase, the instance only after the client runs
 * "Provision my instance" in the portal (1 license = 1 instance).
 */
export interface ClientAccount {
  /** Short unique slug (derived from the academy name). */
  id: string;
  /** Person's name. */
  name: string;
  academyName: string;
  /** Stored lowercase; sign-in lookup is case-insensitive. */
  email: string;
  plan: PlanTier;
  createdAt: string;
  /** Set once the client provisions; null while onboarding. */
  instanceId: string | null;
  avatarSeed: string;
  license: InstanceLicense;
}

export type TicketStatus = "Open" | "Replied" | "Closed";

export interface Ticket {
  id: number;
  instanceId: string;
  subject: string;
  /** e.g. "#482 · updated 3h ago · avg response 4h" */
  meta: string;
  requester: string;
  status: TicketStatus;
}

export interface UsageQuota {
  name: string;
  /** Big display value, e.g. "412" / "18.2 GB" / "9.4k" */
  value: string;
  /** Small note, e.g. "of 5,000" / "bandwidth 38%" */
  limitNote: string;
  pct: number;
}

export interface InstanceMetrics {
  cpuPct: number;
  memPct: number;
  diskPct: number;
  host: string;
  region: string;
  /** e.g. "All systems normal — API, web, admin, database, queue" */
  normalNote: string;
}

export interface UpdateAvailable {
  version: string;
  notes: string;
}

export interface Instance {
  /** Short slug — compose project is "lms_<id>". */
  id: string;
  clientName: string;
  domain: string;
  /** "lms_<id>" */
  dbName: string;
  ports: InstancePorts;
  urls: InstanceUrls;
  version: string;
  health: InstanceHealth;
  membersCount: number | null;
  plan: PlanTier;
  mrr: number;
  status: InstanceStatus;
  uptimePct: number | null;
  createdAt: string;
  backups: InstanceBackups;
  updateAvailable: UpdateAvailable | null;
  /** Queued by the operator rollout. Shows an "Update queued" pill. */
  updateQueued: boolean;
  /** Scheduled by the client ("Update tonight"). Shows a "Scheduled" pill. */
  updateScheduled: boolean;
  mobileBuilds: { ios: MobileBuild; android: MobileBuild };
  license: InstanceLicense;
  tickets: Ticket[];
  usage: UsageQuota[];
  metrics: InstanceMetrics | null;
  owner: string;
  restoreInProgress: { entryLabel: string } | null;
}

export type WaveState = "done" | "active" | "pending";

export interface RolloutWave {
  name: string;
  size: number;
  /** e.g. "passed, 24h soak" / "done" / "6 remaining" */
  note: string;
  state: WaveState;
}

export interface Rollout {
  targetVersion: string;
  status: "In progress" | "Paused" | "Complete";
  updated: number;
  total: number;
  waves: RolloutWave[];
  /** Rollout policy lines shown in the "View plan" dialog. */
  policy: string[];
}

export type AlertSeverity = "critical" | "warning" | "notice";

export interface FleetAlert {
  id: string;
  severity: AlertSeverity;
  title: string;
  /** e.g. "lms_luthier · 02:00 · 2 retries" */
  meta: string;
  /** Inline action label — clicking it resolves the alert. */
  action: string;
  instanceId?: string;
  at: string;
  resolved: boolean;
}

export interface Host {
  name: string;
  region: string;
  instanceCount: number;
  cpuPct: number;
  memPct: number;
  diskPct: number;
}

export interface ActivityEntry {
  id: string;
  actor: string;
  avatarSeed: string;
  /** Rendered as: {prefix}<b>{target}</b>{suffix} */
  prefix: string;
  target: string;
  suffix: string;
  ago: string;
}

export interface FleetStats {
  licenses: number;
  running: number;
  mrr: number;
  mrrNote: string;
}

export interface Persona {
  name: string;
  role: string;
  avatarSeed: string;
}

export interface OpsSettings {
  apiImage: string;
  webImage: string;
  adminImage: string;
  backupWindow: string;
  canarySize: number;
  portRangeBase: number;
}

export interface FleetState {
  /** Self-serve client accounts (license holders), incl. the seeded demo client. */
  clients: ClientAccount[];
  instances: Instance[];
  rollout: Rollout;
  alerts: FleetAlert[];
  hosts: Host[];
  activity: ActivityEntry[];
  stats: FleetStats;
  operator: Persona;
  portalUser: Persona;
  settings: OpsSettings;
  /** First-boot sequence, mirroring the api container command in docker-compose.instance.yml. */
  bootSteps: string[];
  ui: { instanceQuery: string };
}

export interface ProvisionInput {
  id: string;
  domain: string;
  plan: PlanTier;
  adminEmail: string;
}

export interface StatusPillInfo {
  label: string;
  tone: "success" | "warning" | "danger" | "info" | "neutral";
}
