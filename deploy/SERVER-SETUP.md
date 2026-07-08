# Server setup runbook (for the server engineer)

You are setting up a SaaS platform on **one Ubuntu VPS**. It has three parts,
all running on this single server:

1. **Caddy** — the only public entrypoint (ports 80/443, automatic HTTPS).
2. **Control plane** — a web dashboard (Next.js + Postgres, port 3000) where
   the owner manages customers. It talks to Docker on this host.
3. **Customer instances** — the dashboard creates one isolated Docker Compose
   stack per customer (each with its own Postgres/Redis/app containers).
   You never create these by hand; you'll make one test instance from the
   dashboard UI to verify, then delete it.

You need no product knowledge. Follow the steps in order. Total time ≈ 1–2 h
(plus DNS propagation).

---

## 0. Values you need from the owner (fill in before starting)

| Placeholder | Meaning | Example |
|---|---|---|
| `<VPS_IP>` | Public IP of the VPS | `203.0.113.10` |
| `<DOMAIN>` | Base domain | `ontimewebsolutions.com` |
| `<CONSOLE_HOST>` | Dashboard hostname | `operator.<DOMAIN>` |
| `<FLEET_DOMAIN>` | Customer subdomain base | `app.<DOMAIN>` |
| `<ACME_EMAIL>` | Email for HTTPS certs | owner's email |
| `<LMS_REPO_URL>` | Git URL of repo 1 ("LMS") | from owner |
| `<DASH_REPO_URL>` | Git URL of repo 2 ("licensing-dashboard") | from owner |
| `<GITHUB_USER>` / `<GITHUB_PAT>` | GitHub username + token with `repo` read and `read:packages` | from owner |
| `<GHCR_PATH>` | Container registry path for the LMS images | `ghcr.io/<github-org>/<lms-repo-name>` |
| `<OPERATOR_EMAIL>` / `<OPERATOR_PASSWORD>` | First dashboard login for the owner | from owner |

Anything else (Stripe keys, email keys) is optional at setup time — the owner
enters those later in the dashboard UI.

## 1. Base server (Hostinger)

- In hPanel: install the plain **Ubuntu 24.04 LTS** template (NOT a
  "with panel" variant), add your SSH key.
- If the hPanel firewall is enabled, allow inbound **22, 80, 443**.

```bash
ssh root@<VPS_IP>

curl -fsSL https://get.docker.com | sh
apt-get install -y ufw git
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable

docker --version && docker compose version   # both must print versions
```

## 2. DNS (do early — certs need it)

Create these records in the domain's DNS panel, all pointing to `<VPS_IP>`:

| Record | Type | Value |
|---|---|---|
| `operator` | A | `<VPS_IP>` |
| `*.app` | A | `<VPS_IP>` |

Verify before continuing (both must return `<VPS_IP>`):

```bash
dig +short <CONSOLE_HOST>
dig +short anything.<FLEET_DOMAIN>
```

## 3. Clone both repos + registry login

```bash
git clone <LMS_REPO_URL> /opt/lms
cd /opt/lms && git checkout main

git clone <DASH_REPO_URL> /opt/licensing-dashboard
cd /opt/licensing-dashboard && git checkout portal-self-serve

echo <GITHUB_PAT> | docker login ghcr.io -u <GITHUB_USER> --password-stdin
# Sanity check — must succeed (images are built by the repo's CI):
docker pull <GHCR_PATH>/api:latest
```

> If the pull fails with "not found", stop and tell the owner: the CI images
> haven't been published yet (they need to push the LMS repo's `main` branch
> once so GitHub Actions builds them).

## 4. Start Caddy (the public proxy)

```bash
cd /opt/licensing-dashboard/deploy/fleet
ACME_EMAIL=<ACME_EMAIL> docker compose -f docker-compose.caddy.yml up -d

# Admin API is loopback-only; should print JSON (initial routes), not an error:
curl -s http://localhost:2019/config/apps/http/servers/fleet/routes
```

## 5. Configure + start the control plane

```bash
cd /opt/licensing-dashboard/deploy/host
cp .env.example .env
nano .env
```

Set these in `.env` (generate secrets with the commands shown):

```bash
CP_DB_USER=licensing
CP_DB_PASSWORD=$(openssl rand -hex 24)        # paste the output, don't leave the command
CP_DB_NAME=licensing

SESSION_SECRET=$(openssl rand -hex 32)
SETTINGS_ENC_KEY=$(openssl rand -base64 32)

NEXT_PUBLIC_APP_URL=https://<CONSOLE_HOST>
FLEET_BASE_DOMAIN=<FLEET_DOMAIN>

OPERATOR_EMAIL=<OPERATOR_EMAIL>
OPERATOR_PASSWORD=<OPERATOR_PASSWORD>

LMS_REPO_PATH=/opt/lms                        # REQUIRED — provisioning fails without it
LMS_IMAGE_REGISTRY=<GHCR_PATH>
LMS_IMAGE_TAG=latest

CRON_SECRET=$(openssl rand -hex 24)
BACKUP_HOST_DIR=/opt/lms-backups
BACKUP_KEEP_DAYS=7
```

Then:

```bash
mkdir -p /opt/lms-backups
docker compose -f docker-compose.host.yml --env-file .env up -d --build
docker compose -f docker-compose.host.yml logs -f
# wait for: migrations applied → bootstrap done → Next.js listening on :3000
# (Ctrl-C exits the logs, not the app)
```

Open `https://<CONSOLE_HOST>` in a browser — you should get the login page
over valid HTTPS. Log in with `<OPERATOR_EMAIL>` / `<OPERATOR_PASSWORD>`.

## 6. Verify with a throwaway customer instance

In the dashboard (you are logged in as the owner-level operator):

1. Create a client (any name, e.g. `Test Co`) — if asked for a plan, pick any.
2. On the client's page, **create an instance**: name `testco`, admin email
   `test@example.com`. Watch it go from *provisioning* to **LIVE**
   (first time pulls images, can take a few minutes).
3. Verify in a browser (HTTPS must work on all three — certs are issued on
   first hit, so allow ~10 s each):
   - `https://testco.<FLEET_DOMAIN>` → a website loads
   - `https://testco-admin.<FLEET_DOMAIN>` → an admin login page loads
   - `https://testco-api.<FLEET_DOMAIN>/health` → `{"status":"ok"}`
4. Confirm isolation from the shell: `docker ps` shows containers prefixed
   `lms_<id>`, and `curl http://<VPS_IP>:6001` (any instance port) from your
   laptop must **fail** — instance ports are loopback-only.
5. Test lifecycle from the dashboard: **pause** it (containers stop), **resume**
   it (site comes back), then **delete/destroy** it (containers and volumes
   gone: `docker ps -a | grep lms_` is empty).

If all five pass, the platform works end to end.

## 7. Backups + scheduled jobs (cron)

`crontab -e` on the host, add (replace `<CRON_SECRET>` and `<CONSOLE_HOST>`):

```cron
15 3 * * * cd /opt/licensing-dashboard/deploy/host && docker compose -f docker-compose.host.yml exec -T dashboard node scripts/backup-instances.mjs >> /var/log/lms-backup.log 2>&1
45 3 * * * curl -s -X POST -H "x-cron-secret: <CRON_SECRET>" https://<CONSOLE_HOST>/api/jobs/run-reminders
0  4 * * * curl -s -X POST -H "x-cron-secret: <CRON_SECRET>" https://<CONSOLE_HOST>/api/jobs/reconcile-routes
```

Next morning, check `/opt/lms-backups/` contains dump files. Finally, take a
**snapshot** in hPanel now that everything is green.

## 8. Hand back to the owner

- Dashboard URL `https://<CONSOLE_HOST>` + the operator login you set.
- The filled `.env` lives at `/opt/licensing-dashboard/deploy/host/.env`
  (contains secrets — do not copy it anywhere else; the owner should have the
  values in a password manager).
- Backups land in `/opt/lms-backups/` (7-day retention).
- Repos live at `/opt/lms` (branch `main`) and `/opt/licensing-dashboard`
  (branch `portal-self-serve`).
- Updating later (owner will ask when):
  - Platform app: `cd /opt/licensing-dashboard && git pull && cd deploy/host && docker compose -f docker-compose.host.yml --env-file .env up -d --build`
  - Customer instances: `cd /opt/lms && git pull` — instance updates are then
    done from the dashboard/by the owner (new images are pulled per instance).

The owner handles everything product-side afterwards (pricing, payment keys,
email domain, migrating their existing school onto the platform).

## Troubleshooting

| Symptom | Check |
|---|---|
| No HTTPS cert / connection refused | DNS records resolve to `<VPS_IP>` (§2)? Ports 80+443 open in BOTH ufw and the hPanel firewall (§1)? `docker logs` on the caddy container. |
| Dashboard unreachable | `docker compose -f docker-compose.host.yml ps` and `logs dashboard` in `/opt/licensing-dashboard/deploy/host`. |
| Instance stuck in *provisioning* | `LMS_REPO_PATH=/opt/lms` set in `.env`? `docker login ghcr.io` done? `docker compose -f docker-compose.host.yml logs dashboard` shows the compose error. |
| Instance LIVE but URL 404s | Wildcard `*.app` DNS record present? Re-run route sync: the reconcile-routes cron line from §7 (or wait for 04:00). |
| GHCR pull "not found" | Owner must push LMS `main` once so CI publishes images (§3 note). |
