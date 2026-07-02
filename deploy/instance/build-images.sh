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

echo "Building LMS instance images from $ROOT ..."
docker build -f apps/api/Dockerfile   -t "${API_IMAGE:-lms-api:local}"     .
docker build -f apps/web/Dockerfile   -t "${WEB_IMAGE:-lms-web:local}"     .
docker build -f apps/admin/Dockerfile -t "${ADMIN_IMAGE:-lms-admin:local}" .

echo
echo "Done. Built:"
echo "  ${API_IMAGE:-lms-api:local}"
echo "  ${WEB_IMAGE:-lms-web:local}"
echo "  ${ADMIN_IMAGE:-lms-admin:local}"
