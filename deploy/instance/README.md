# Per-instance provisioning template

This folder packages the LMS so the **control-plane dashboard** can spin up one
**fully isolated instance per client license** ("1 license = 1 instance"). Local
now; a cloud driver swaps in later behind the same idea.

## Model

- **One image set, many instances.** Build `lms-api`, `lms-web`, `lms-admin`
  **once** (`build-images.sh`). Each instance just *runs* those images with its
  own env — no per-client rebuild. This works because the web/admin API/web
  origins are resolved at **runtime** (`RUNTIME_API_URL` → `/__env.js` →
  `window.__ENV__`), not baked at build time.
- **Full isolation per instance.** `docker compose -p lms_<id>` namespaces every
  container and the `pg` / `redis` / `uploads` volumes, so each tenant has its
  own database, queue, and uploaded media. No shared state.
- **Distinct ports.** API / web / admin are each published on their own host
  port (`API_PORT` / `WEB_PORT` / `ADMIN_PORT`), allocated by the provisioner.
- **Boots ready.** On first start the api container runs `prisma migrate deploy`
  then the parameterized seed, creating the first admin from `SEED_ADMIN_*`.
  Real clients boot empty (`SEED_DEMO_CONTENT=false`); integrations (Stripe,
  email, …) are configured later in the instance's own admin Settings.

## One-time: build the images

```bash
deploy/instance/build-images.sh
# → lms-api:local, lms-web:local, lms-admin:local
```

## Provision an instance

```bash
# 1. Make an env file (the provisioner generates this; or copy the example):
cp deploy/instance/.env.instance.example deploy/instance/acme.env
#    → set unique API_PORT/WEB_PORT/ADMIN_PORT, secrets, SEED_ADMIN_*

# 2. Bring it up:
docker compose -p lms_acme \
  --env-file deploy/instance/acme.env \
  -f deploy/instance/docker-compose.instance.yml up -d

# 3. Wait for health, then:
#    API   → http://localhost:<API_PORT>/health   ({"status":"ok"})
#    Web   → http://localhost:<WEB_PORT>
#    Admin → http://localhost:<ADMIN_PORT>         (login: SEED_ADMIN_*)
```

## Lifecycle

```bash
docker compose -p lms_acme ... stop          # suspend (keeps data)
docker compose -p lms_acme ... start         # resume
docker compose -p lms_acme ... down          # stop + remove containers (keeps volumes)
docker compose -p lms_acme ... down -v       # destroy, INCLUDING data volumes
```

The control-plane `LocalDockerDriver` wraps exactly these commands; a cloud
driver will implement the same verbs against a hosting API.

## What's intentionally NOT here

- **No Caddy.** TLS/single-domain routing belongs to the production VPS compose
  (`deploy/docker-compose.yml`) or the cloud ingress. Locally we publish ports.
- **No provider secrets.** Stripe / PayPal / SMTP / Mux are entered per instance
  in that instance's admin Settings (encrypted with its own `SETTINGS_ENC_KEY`).
- **Mobile apps.** "Apps included" is a separate per-client EAS build track — the
  app binary points at this instance's `API_PORT`/public API URL.
