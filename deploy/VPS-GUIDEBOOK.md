# Full-platform VPS guidebook — Hostinger KVM 4

Everything on one dedicated VPS: **operator dashboard, client portal, the
fleet of client LMS instances, and the member-facing apps** (web + admin per
instance; mobile via the store track). Written against the current state of
both repos (2026-07-07):

| Repo | Deploy from | Provides |
|---|---|---|
| `LMS` (this repo) | `main` | The product: API/web/admin images ([images.yml](../.github/workflows/images.yml)), per-instance stack ([instance/](instance/)), mobile app (`apps/mobile`) |
| `licensing-dashboard` | `portal-self-serve` | The control plane: operator dashboard, client portal, provisioner, fleet Caddy ingress, custom domains, EAS orchestrator |

> `apps/control-plane` in this repo is a **static UI with a mock provisioner**
> (sales page + design surfaces). The functional operator/client dashboards
> live in the `licensing-dashboard` repo. Don't deploy `apps/control-plane`
> expecting it to manage instances.

---

## 0. Architecture on this box

**One Caddy owns :80/:443** — the fleet ingress from
`licensing-dashboard/deploy/fleet/`. Every HTTP surface sits behind it:

```
                    Hostinger KVM4 (Ubuntu 24.04)
  internet ──► Caddy (host net, :80/:443, admin API on 127.0.0.1:2019)
                │  routes managed live by the control plane
                ├── console.<domain>          → dashboard :3000 (operator + /portal)
                ├── <client>.app.<domain>     → instance web  (127.0.0.1:<WEB_PORT>)
                ├── <client>-admin.app.<domain>→ instance admin (127.0.0.1:<ADMIN_PORT>)
                ├── <client>-api.app.<domain> → instance api   (127.0.0.1:<API_PORT>)
                └── <custom domain>           → that instance's web port (verified only)

  control plane (deploy/host compose, host net)
    ├── Next.js dashboard :3000  — operator RBAC + client portal + provisioner
    ├── Postgres 16 (127.0.0.1:5432) — control-plane DB
    ├── /var/run/docker.sock mount — drives instance compose projects
    └── reads /opt/lms/deploy/instance/docker-compose.instance.yml

  instances: docker compose -p lms_<id> … (one per license)
    └── postgres + redis + api + web + admin, volumes namespaced per project,
        ports bound to 127.0.0.1 only, images pulled from GHCR
```

**Consequences of the one-Caddy rule:**

- Do **not** run this repo's [deploy/docker-compose.yml](docker-compose.yml)
  (the standalone flagship stack) on this box — it ships its own Caddy and
  will fight for :80/:443. See Appendix A.
- Your **flagship school runs as instance #1**, provisioned by the control
  plane like any client. One uniform ops model for every school including
  your own. (Done 2026-07-08: "Spotlight Academy" on the fleet, demo-seeded;
  the legacy `lms.websitedesignpixel.com` deployment was retired outright —
  final data archived at `/opt/lms-backups/legacy-plesk/` on the VPS.)

**Capacity (KVM 4 = 4 vCPU / 16 GB / 200 GB NVMe):** control plane + Caddy
≈ 1.5 GB; each instance ≈ 1–1.5 GB under light load. Comfortable for the
flagship + ~6–10 small client instances; disk is the least of your worries.

---

## 1. Inventory — have these before starting

- **Domain + DNS access** (zone can stay on the Plesk panel).
- **GitHub PAT** with `read:packages` (pull GHCR images) and repo read (clone
  private repos). Fine-grained or classic both work.
- **Stripe account** for *selling licenses* (control-plane checkout). Note:
  the current `portal-self-serve` checkout is **USD-hardcoded** and the known
  Stripe-India activation issue applies — see §14 gaps.
- **Resend API key** (optional at boot) for control-plane emails; each
  instance configures its own email provider later in its own admin.
- **Expo account + token** only when you start white-label mobile builds.

Generate secrets as you go: `openssl rand -hex 32` (session/JWT),
`openssl rand -base64 32` (settings keys), `openssl rand -hex 24` (DB passwords).

---

## 2. hPanel prep (Hostinger-specific)

1. **OS**: plain **Ubuntu 24.04 LTS** template — not the CloudPanel/CyberPanel
   variants (they occupy :80/:443).
2. **SSH key** added in hPanel; disable password login once key auth works.
3. **Data center**: nearest to your members (e.g. Mumbai for an Indian
   audience).
4. **hPanel firewall** (network-level, separate from ufw): if enabled, allow
   **22, 80, 443** only.
5. **Snapshots/backups**: take a manual snapshot before first setup and before
   any risky change. Weekly auto-backups are included but are not a substitute
   for the DB dumps in §12.

## 3. Server bootstrap

```bash
ssh root@YOUR.VPS.IP

curl -fsSL https://get.docker.com | sh
apt-get install -y ufw git
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable

docker --version && docker compose version
```

No swap needed at 16 GB.

## 4. DNS plan

A records → VPS IP. As built on `ontimewebsolutions.com`:

| Record | Type | Purpose |
|---|---|---|
| `operator` | A | Control plane (operator dashboard + client portal) |
| `*.app` | A (wildcard) | Fleet subdomains: `<client>.app`, `<client>-admin.app`, `<client>-api.app` |

Caddy issues certs via HTTP-01 on first request, so records must resolve
before the first hit. Client custom domains are added per instance from the
dashboard (they need their own DNS record + verify step).

## 5. Code + images onto the box

```bash
# The product repo — read by the provisioner for the instance compose file
git clone https://github.com/<owner>/<lms-repo>.git /opt/lms
cd /opt/lms && git checkout main

# The control plane
git clone https://github.com/<owner>/licensing-dashboard.git /opt/licensing-dashboard
cd /opt/licensing-dashboard && git checkout portal-self-serve

# GHCR pull auth (PAT with read:packages)
echo <GITHUB_PAT> | docker login ghcr.io -u <github-username> --password-stdin
```

**Images**: pushing to `main` runs [images.yml](../.github/workflows/images.yml)
which publishes `ghcr.io/<owner>/<repo>/{api,web,admin}:{latest,sha-…}`.
Confirm the three packages exist in GitHub → Packages before provisioning.
(Fallback: `deploy/instance/build-images.sh` builds `lms-*:local` on the box —
KVM4 handles it, but GHCR keeps every host and rollback on pinned tags.)

## 6. Fleet ingress (Caddy) up first

```bash
cd /opt/licensing-dashboard/deploy/fleet
ACME_EMAIL=you@example.com docker compose -f docker-compose.caddy.yml up -d

# admin API only on loopback — should return the initial route set:
curl -s http://localhost:2019/config/apps/http/servers/fleet/routes
```

Caddy runs on the host network; the control plane adds/removes instance
routes live through `127.0.0.1:2019`, and config persists in the
`caddy_config` volume across restarts.

## 7. Control plane up

```bash
cd /opt/licensing-dashboard/deploy/host
cp .env.example .env && nano .env
```

Minimum viable `.env`:

| Var | Value |
|---|---|
| `CP_DB_USER` / `CP_DB_PASSWORD` / `CP_DB_NAME` | control-plane Postgres creds (generate the password) |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `SETTINGS_ENC_KEY` | `openssl rand -base64 32` — encrypts operator-entered secrets; back it up with the DB |
| `NEXT_PUBLIC_APP_URL` | `https://console.<domain>` |
| `OPERATOR_EMAIL` / `OPERATOR_PASSWORD` / `OPERATOR_NAME` | first Owner account (bootstrap creates it once, then ignores) |
| `FLEET_BASE_DOMAIN` | `app.<domain>` (must match the wildcard DNS) |
| `LMS_REPO_PATH` | `/opt/lms` — **required**: the code default is a macOS path (`/Users/amardeepsingh/LMS`) and provisioning fails without this override |
| `LMS_IMAGE_REGISTRY` / `LMS_IMAGE_TAG` | `ghcr.io/<owner>/<repo>` / `latest` (or a pinned `sha-…`) |
| `CRON_SECRET` | random — protects `/api/jobs/*` (§12) |
| `BACKUP_HOST_DIR` / `BACKUP_KEEP_DAYS` | `/opt/lms-backups` / `7` |
| Stripe / Resend / EAS keys | optional now; can be entered later in dashboard Settings (stored encrypted) |

`PROVISION_DRIVER=cloud` is already set in the compose file — the cloud
driver is what binds instance ports to loopback, injects real URLs/CORS, and
registers Caddy routes. Then:

```bash
docker compose -f docker-compose.host.yml --env-file .env up -d --build
docker compose -f docker-compose.host.yml logs -f   # migrations → bootstrap → Next.js :3000
```

First boot runs `prisma migrate deploy`, seeds the three plans
(Solo 1 / Team 3 / Unlimited) and your Owner operator. Log in at
`https://console.<domain>` → operator dashboard at `/dashboard`, client
portal at `/portal`.

## 8. Stripe for license sales

1. Dashboard → Settings (Owner-only): enter `STRIPE_SECRET_KEY` +
   publishable key (or pin them in `.env`).
2. Stripe dashboard → webhook endpoint `https://console.<domain>/api/webhooks/stripe`;
   put the signing secret in Settings/`.env`.
3. Dashboard → Plans: set real prices (they seed **unpriced**).
4. Client subscription lifecycle is then: operator creates client → checkout
   session → webhook reconciles → portal shows license usage; "Manage
   billing" hands off to the Stripe customer portal.

## 9. Provision the first client instance

Do the first one as a client would, via the portal, watching logs:

1. Operator dashboard → create client (+ subscription, or trial).
2. Portal (`/portal`, client login) → **Create instance** (name + admin email)
   — gated by `used < licenseCount`.
3. Under the hood: subdomain slug + 3 ports allocated (6000+ range, advisory
   lock), per-instance secrets minted and encrypted into the Instance row,
   `docker compose -p lms_<id>` pulls GHCR images and boots
   (`prisma migrate deploy` + parameterized seed creates the instance's first
   admin from `SEED_ADMIN_*`), then three Caddy routes register:
   `<slug>.app.<domain>`, `<slug>-admin.…`, `<slug>-api.…`.
4. Status flips LIVE when `http://127.0.0.1:<apiPort>/health` returns 200.

Verify from outside: member site on the subdomain, admin login with the
seeded credentials, `https://<slug>-api.app.<domain>/health` → OK. Then, in
**that instance's own admin → Settings**, the client (or you) enters their own
Stripe/PayPal, email, Mux, Zoom credentials — encrypted with that instance's
own `SETTINGS_ENC_KEY`. Instances are commercially self-contained.

Lifecycle (portal or operator dashboard): pause = `stop`, resume = `start`,
destroy = `down -v` (Owner-only, irreversible, frees the license). Manual
fallback commands: [instance/README.md](instance/README.md).

## 10. Flagship as instance #1 (+ custom domain cutover)

> **Status 2026-07-08:** superseded by events — the flagship was provisioned
> fresh as "Spotlight Academy" (demo seed) and the whole
> `websitedesignpixel.com` deployment was retired: pm2 apps deleted on the
> Plesk box, `main.yml` auto-deploy removed, final DB + uploads archived at
> `/opt/lms-backups/legacy-plesk/` on the VPS. The steps below remain as the
> reference procedure for migrating any external LMS into a fleet instance.

1. Provision an instance for yourself (e.g. slug `spotlight`), `SEED_DEMO_CONTENT=false`.
2. **Data migration** from the old Plesk deployment:
   ```bash
   # old box: dump
   pg_dump -Fc lms > flagship.dump
   # VPS: restore into the instance's postgres container
   docker cp flagship.dump $(docker ps -q -f label=com.docker.compose.project=lms_<id> -f label=com.docker.compose.service=postgres):/tmp/
   docker exec -it <that-container> pg_restore -U postgres -d lms --clean /tmp/flagship.dump
   # uploads: rsync the old images/files dirs into the instance's uploads volume (/data)
   ```
3. **Secrets caveat**: the restored `Setting` rows were encrypted with the old
   flagship `SETTINGS_ENC_KEY`; the new instance has its own key, so those
   rows won't decrypt. Simplest: re-enter Stripe/PayPal/email/Mux/Zoom once in
   the instance admin Settings (10 minutes). (Alternative — carrying the old
   key into the instance env — works but breaks the "provisioner owns instance
   secrets" model; avoid unless you must.)
4. **Custom domain**: portal/dashboard → attach `lms.websitedesignpixel.com`
   → set the DNS record → verify → Caddy adds the route and CORS extends
   automatically. Flip the A record when ready; keep the fleet subdomain as a
   fallback URL.
5. **Member Stripe webhooks** for this instance now point at
   `https://<slug>-api.app.<domain>/billing/webhook` — update the endpoint in
   the school's Stripe account and store the new signing secret in the
   instance admin.
6. Decommission: disable the old GH Actions deploy to Plesk (and close/park
   PR #18, which hardens that legacy path).

## 11. Mobile apps

- **Shared app track**: one binary for all shared-track clients. On first run
  the member enters a connect code (instance subdomain); the app calls the
  public resolver `GET https://console.<domain>/api/app/resolve?code=<slug>`
  and binds to that instance's API/web URLs. Build once from `apps/mobile`
  with production env, ship to your own store accounts.
- **White-label track**: per-client binaries. Dashboard → instance →
  WhiteLabelConfig (app name, scheme, iOS bundle ID, Android package, EAS
  project/owner, client store credentials — stored encrypted). "Build iOS /
  Android" shells out to `eas build --profile production` with `INSTANCE_*`
  env; a pre-install hook pulls that instance's branding (icon/splash) from
  its `GET /app/config`. Submission (`eas submit`) is operator-triggered,
  never automatic. Prereqs: Expo token in Settings, `eas-cli` available where
  the dashboard runs — **verify the deployed dashboard image includes
  `eas-cli` before promising white-label builds; add it if not.**
- Store accounts: client-owned Apple ($99/yr) + Google ($25) accounts,
  operator-managed — start enrollment early, review lead times are real.
- In-app theming needs no builds at all: instances re-brand live via the
  AppConfig endpoint (30 s poll).

## 12. Backups + scheduled jobs

```bash
# nightly per-instance DB dumps (script ships in the dashboard repo)
crontab -e
15 3 * * * cd /opt/licensing-dashboard/deploy/host && docker compose -f docker-compose.host.yml exec -T dashboard node scripts/backup-instances.mjs >> /var/log/lms-backup.log 2>&1

# control-plane DB dump (its postgres listens on 127.0.0.1:5432)
30 3 * * * docker exec $(docker ps -q -f name=postgres -f label=com.docker.compose.project=host) pg_dump -U ${CP_DB_USER} ${CP_DB_NAME} | gzip > /opt/lms-backups/control-plane-$(date +\%F).sql.gz

# dashboard jobs: payment reminders + Caddy route/custom-domain reconciliation
45 3 * * * curl -s -X POST -H "x-cron-secret: <CRON_SECRET>" https://console.<domain>/api/jobs/run-reminders
0  4 * * * curl -s -X POST -H "x-cron-secret: <CRON_SECRET>" https://console.<domain>/api/jobs/reconcile-routes
```

Also: sync `/opt/lms-backups` off-box (any object storage / rclone target),
and snapshot in hPanel before upgrades. Uploads volumes are covered by
instance-level dumps only if you add them — rsync `/var/lib/docker/volumes/lms_<id>_uploads`
into the backup dir if client media matters (it does).

## 13. Updates & rollouts

- **Product (instances)**: merge to LMS `main` → images.yml publishes new
  GHCR tags → bump `LMS_IMAGE_TAG` (prefer pinned `sha-…` over `latest`) →
  redeploy instances wave-by-wave (`docker compose -p lms_<id> pull && up -d`;
  migrations run on boot). The stored per-instance tag gives you lockstep +
  reproducibility.
- **Control plane**: `git pull` in `/opt/licensing-dashboard` →
  `docker compose -f deploy/host/docker-compose.host.yml --env-file .env up -d --build`.
- **Caddy**: routes live in the DB too — after any Caddy mishap,
  `POST /api/jobs/reconcile-routes` replays them.

## 14. Current-git gaps — punch list before real clients

1. **PR #17 (member password reset) is still OPEN** — merge before member-facing
   launch; images built from `main` don't include it yet.
2. **License checkout is USD-hardcoded** on `portal-self-serve` (per-plan
   currency exists, checkout doesn't honor it yet) and the Stripe-India
   activation problem blocks USD — decide: activate a proper Stripe entity or
   finish INR checkout. **Plans seed unpriced** — set prices (§8).
3. **`licensing-dashboard` deploys from branch `portal-self-serve`** — merge it
   to its `main` when stable so the VPS tracks a mainline.
4. **Email**: control-plane From defaults to `onboarding@resend.dev`
   (owner-only delivery) — verify a sending domain in Resend for both the
   control plane and instance transactional mail.
5. **`eas-cli` presence in the dashboard runtime image** — verify before
   selling the white-label track (§11).
6. ~~PR #18 / `main.yml`~~ — done 2026-07-08: the Plesk auto-deploy workflow
   is removed and the legacy stack is stopped; PR #15 (docs) remains open.
7. First fleet run on real hardware: after §9, run one **throwaway** instance
   end-to-end (provision → live → pause → resume → destroy) before onboarding
   a paying client.

## 15. Verification checklist

- [ ] `https://console.<domain>` login works; RBAC pages match your role
- [ ] Plans priced; Stripe webhook delivers (Stripe dashboard → recent events 200)
- [ ] Test instance LIVE; all three fleet subdomains serve over HTTPS
- [ ] Instance admin login with seeded credentials; member signup on the web app
- [ ] Instance API `/health` OK via subdomain; ports NOT reachable via `http://VPS_IP:<port>` from outside (loopback binding)
- [ ] Custom domain attach + verify flow on a spare subdomain
- [ ] Connect-code resolver returns the instance (`/api/app/resolve?code=<slug>`)
- [ ] Backup cron produced dumps; test-restore one into a scratch container
- [ ] `docker compose -p lms_<id> down && up -d` — instance returns clean (route + data intact)
- [ ] hPanel snapshot taken with everything green

---

## Appendix A — when to use the standalone flagship compose instead

[deploy/docker-compose.yml](docker-compose.yml) + [Caddyfile](Caddyfile) is the
right shape for a **single-school box with no fleet** (one domain, builds on
host, own Caddy). On the fleet VPS it conflicts with the fleet ingress — don't
mix them on one host. If you ever want a dedicated box for one big client,
that compose is the tool.

## Appendix B — manual instance provisioning

The control plane does all of this for you, but the manual path (debugging,
air-gapped test) is: [instance/README.md](instance/README.md) +
[instance/.env.instance.example](instance/.env.instance.example) — note the
example's `PORT_BIND_IP` defaults to loopback, so add Caddy routes yourself via
the admin API if you go manual on the fleet box.
