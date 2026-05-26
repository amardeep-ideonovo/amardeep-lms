# Deploying the LMS to a VPS with Docker

This guide takes the whole stack — **API + member web + admin + PostgreSQL +
Redis** — and runs it on one Linux server behind **Caddy** (which gives you
automatic HTTPS). The **mobile app is a separate track** (see the last section).

> Your existing Plesk shared-hosting box can't run this (no Docker/Postgres).
> Use it for your **domain, DNS, and email**; rent a small **VPS** for the app.

---

## 0. What you need first

- A **domain name** you control (e.g. `example.com`). You'll point DNS at the VPS.
- A **VPS** (a rented Linux server). Recommended size: **2 vCPU / 4 GB RAM / 40 GB disk**
  running **Ubuntu 24.04**. Providers: Hetzner, DigitalOcean, Vultr, Linode (~$6–18/mo).
  - 2 GB RAM can OOM while building 3 images — if that's all you have, add swap
    (shown below) or use the "build elsewhere" note in §9.
- These three **app-level fixes** should be done before real users (details in §10):
  1. Verify the **admin production build** works in Docker.
  2. Decide **upload storage** (the compose uses a persistent volume — fine for one VPS).
  3. Put **real secrets** + a **real video provider (Mux)** in `deploy/.env`.

---

## 1. Point your domain at the VPS

In your DNS provider (could be your Plesk panel), create **A records** → your VPS's public IP:

| Host | Type | Value |
|------|------|-------|
| `@` (example.com) | A | `YOUR.VPS.IP` |
| `www` | A | `YOUR.VPS.IP` |
| `api` | A | `YOUR.VPS.IP` |
| `admin` | A | `YOUR.VPS.IP` |

DNS can take minutes to a few hours to propagate. Caddy won't get HTTPS certs until these resolve.

---

## 2. First-time server setup

SSH in as root (your VPS provider gives you the IP + password/key):

```bash
ssh root@YOUR.VPS.IP
```

Install Docker (official convenience script) and open the firewall:

```bash
# Docker Engine + Compose plugin
curl -fsSL https://get.docker.com | sh

# Firewall: allow SSH + web traffic only
apt-get install -y ufw
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable

# (Optional, for 2 GB RAM boxes) add 2 GB swap so builds don't OOM:
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

Verify: `docker --version && docker compose version`.

---

## 3. Get the code onto the server

```bash
cd /opt
git clone <YOUR_REPO_URL> lms     # private repo? use a GitHub deploy key or PAT
cd lms
git checkout amardeepLMS          # or main, whichever you deploy
```

---

## 4. Configure secrets

```bash
cp deploy/.env.example deploy/.env
nano deploy/.env                  # fill everything in
```

Generate strong secrets:

```bash
openssl rand -hex 32      # -> JWT_SECRET
openssl rand -base64 32   # -> SETTINGS_ENC_KEY
openssl rand -hex 24      # -> POSTGRES_PASSWORD
```

Set `DOMAIN`, `ACME_EMAIL`, and the three public URLs to your real domain:

```
DOMAIN=example.com
ACME_EMAIL=you@example.com
PUBLIC_API_URL=https://api.example.com
WEB_APP_URL=https://example.com
CORS_ORIGIN=https://example.com,https://admin.example.com
```

> `deploy/.env` holds live secrets — it's gitignored. Never commit it.

---

## 5. Build and start everything

```bash
docker compose -f deploy/docker-compose.yml up -d --build
```

First build takes several minutes (it installs the workspace and builds 3 apps).
The API container **runs database migrations automatically on startup**
(`prisma migrate deploy`), then starts.

Watch it come up:

```bash
docker compose -f deploy/docker-compose.yml ps
docker compose -f deploy/docker-compose.yml logs -f api
```

---

## 6. Create your first admin & (optionally) seed content

The repo seed (`packages/db/prisma/seed.ts`) creates **demo** content. For a real
launch you want a real admin login, not demo data. To run the seed anyway (demo):

```bash
docker compose -f deploy/docker-compose.yml exec api sh -c "cd packages/db && npx prisma db seed"
```

> If the seed doesn't give you an admin account you can log into, tell me and
> I'll add a small one-off `create-admin` script (email + password → admin user).

---

## 7. Verify it's live

- `https://example.com` → member site
- `https://admin.example.com` → admin console
- `https://api.example.com/health` → should return OK

Caddy issues HTTPS certificates automatically on first request (needs §1 DNS +
ports 80/443 open). If certs fail, check `docker compose -f deploy/docker-compose.yml logs caddy`.

---

## 8. Stripe webhook (if using billing)

In the Stripe dashboard, add a webhook endpoint:

```
https://api.example.com/billing/webhook
```

Copy its signing secret into `deploy/.env` as `STRIPE_WEBHOOK_SECRET`, then:

```bash
docker compose -f deploy/docker-compose.yml up -d
```

---

## 9. Updating after you push code

```bash
cd /opt/lms
git pull
docker compose -f deploy/docker-compose.yml up -d --build
```

> **Low-RAM/CPU VPS?** Instead of building on the server, build the images on a
> beefier machine or CI, push them to a registry (e.g. GHCR), and have the
> server `docker compose pull` + `up -d`. Ask me and I'll add a GitHub Actions
> workflow that also runs the BDD gate before publishing images.

---

## 10. Before real users — the must-fix list

- **Admin build:** the first `docker compose build` is the real test. The repo
  pins React to a single 18.2.0 via root `overrides`, which should resolve the
  earlier duplicate-React build failure — but confirm the `admin` image builds.
- **Video:** Mux signed playback must be configured (`MUX_*` keys) for real
  course videos; the current sample uses a public test stream.
- **Uploads:** this setup stores images + note files on the `uploads` Docker
  volume (persists across redeploys on this one server). If you ever scale to
  more than one server, switch to object storage (S3/Cloudflare R2).
- **Backups:** automate a daily DB dump (cron):
  ```bash
  docker compose -f deploy/docker-compose.yml exec -T postgres \
    pg_dump -U postgres lms | gzip > /opt/backups/lms-$(date +\%F).sql.gz
  ```
  Also back up the `uploads` volume.
- **CORS / URLs:** make sure `CORS_ORIGIN`, `WEB_APP_URL`, `PUBLIC_API_URL` all
  use your real https domain.

---

## 11. Mobile app (separate track)

The Expo app is **not** deployed to this server — it ships to the app stores.
Point it at production and build with EAS:

- Set `EXPO_PUBLIC_API_URL=https://api.example.com` (and
  `EXPO_PUBLIC_WEB_ACCOUNT_URL=https://example.com/account`) for the production build.
- `eas build --profile production` for Android/iOS, then `eas submit`.
- Needs an Apple Developer account ($99/yr) and Google Play account ($25 once);
  store review adds lead time — start this early.

---

## Architecture (what runs where)

```
                 Caddy (:80/:443, auto-HTTPS)
        ┌────────────┼─────────────┬─────────────┐
   example.com   www ->apex   api.example.com  admin.example.com
        │                          │                 │
      web:3002                  api:3000          admin:3001
     (Next.js)                 (NestJS)           (Next.js)
                                  │   │
                       ┌──────────┘   └──────────┐
                   postgres:5432              redis:6379
                  (pg volume)                (redis volume)
                                  │
                          uploads volume  (/data/images, /data/files)
```

Only Caddy is exposed to the internet; Postgres/Redis/api/web/admin talk to each
other on the private compose network.
