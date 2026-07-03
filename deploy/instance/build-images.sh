#!/usr/bin/env bash
# Build the three shared LMS images ONCE. Every provisioned instance reuses them
# — runtime env (RUNTIME_API_URL + /__env.js) lets a single prebuilt web/admin
# image serve any instance, so there is no per-client rebuild.
#
# Re-run this after changing app code to refresh the images; running instances
# pick up the new image on their next `up`/recreate.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)" # repo root (two levels up)
cd "$ROOT"

# Version stamp baked into the API image for the app<->API handshake
# (date + git sha, e.g. 2026.07.03-abc1234). Override with APP_VERSION.
STAMP="${APP_VERSION:-$(date +%Y.%m.%d)-$(git rev-parse --short HEAD 2>/dev/null || echo unknown)}"

echo "Building LMS instance images from $ROOT (APP_VERSION=$STAMP) ..."
docker build -f apps/api/Dockerfile   -t "${API_IMAGE:-lms-api:local}"     --build-arg APP_VERSION="$STAMP" .
docker build -f apps/web/Dockerfile   -t "${WEB_IMAGE:-lms-web:local}"     .
docker build -f apps/admin/Dockerfile -t "${ADMIN_IMAGE:-lms-admin:local}" .

echo
echo "Done. Built:"
echo "  ${API_IMAGE:-lms-api:local}"
echo "  ${WEB_IMAGE:-lms-web:local}"
echo "  ${ADMIN_IMAGE:-lms-admin:local}"
