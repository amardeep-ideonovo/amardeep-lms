#!/usr/bin/env bash
# One-time migration for instances provisioned BEFORE MEDIA_DIR/CERT_FILES_DIR
# were pinned to /data in the compose files.
#
# Those instances resolve the API's cwd-relative fallbacks, so gallery media,
# admin/member avatars and rendered certificate PDFs were written into the
# container's writable layer instead of the `uploads` volume.
#
#   RUN THIS BEFORE UPGRADING. The upgrade recreates the container, and the
#   writable layer — with every file below — is destroyed with it. There is no
#   recovering them afterwards: they were never on the volume, so they are not
#   in any backup-uploads.sh archive either.
#
# Idempotent: -n never clobbers a file already on the volume, so a re-run after
# a partial pass is safe.
#
#   ./migrate-media-to-volume.sh              # every running LMS api container
#   ./migrate-media-to-volume.sh lms_abc123   # one compose project
#   DRY_RUN=1 ./migrate-media-to-volume.sh    # report only, copy nothing
set -euo pipefail

DRY_RUN="${DRY_RUN:-0}"
ONLY_PROJECT="${1:-}"

# old cwd-relative path -> the /data path compose now pins it to.
#
# Only these two need rescuing: BLOG_IMAGES_DIR and LESSON_FILES_DIR were
# already pinned to /data long before the others, so their files have always
# been on the volume.
#
# The left side is where an UNPINNED api resolved to (container WORKDIR /app +
# the dev fallback from apps/api/src/storage/storage-dirs.ts). The right side
# MUST equal the pin in deploy/instance/docker-compose.instance.yml, or this
# rescues files into a directory the upgraded api never reads — reporting
# success while the data stays lost. deploy-pins.spec.ts asserts both sides
# against that table and the compose file, so drift fails the build instead.
PAIRS=(
  "/app/src/media-uploads:/data/media"
  "/app/src/files/certificates:/data/files/certificates"
)

# Portable read loop rather than `mapfile` — macOS still ships bash 3.2.
CONTAINERS=()
while IFS= read -r line; do
  [ -n "$line" ] && CONTAINERS+=("$line")
done < <(
  docker ps --filter "label=com.docker.compose.service=api" \
    --format '{{.ID}} {{.Label "com.docker.compose.project"}}'
)

if [ "${#CONTAINERS[@]}" -eq 0 ]; then
  echo "[migrate-media] no running LMS api containers found — nothing to do."
  exit 0
fi

total_copied=0
for entry in "${CONTAINERS[@]}"; do
  cid="${entry%% *}"
  project="${entry#* }"
  [ -n "$ONLY_PROJECT" ] && [ "$project" != "$ONLY_PROJECT" ] && continue

  echo "=== $project ($cid)"
  for pair in "${PAIRS[@]}"; do
    src="${pair%%:*}"
    dst="${pair##*:}"

    # Count real files only; the tracked .gitignore placeholder is not data.
    n=$(docker exec "$cid" sh -c \
      "find '$src' -maxdepth 1 -type f ! -name '.gitignore' 2>/dev/null | wc -l" | tr -d '[:space:]')
    if [ "${n:-0}" -eq 0 ]; then
      echo "  $src -> $dst : nothing to migrate"
      continue
    fi

    if [ "$DRY_RUN" = "1" ]; then
      echo "  $src -> $dst : would copy $n file(s)"
      continue
    fi

    # cp's exit code is not the signal — `-n` reports differently across
    # implementations, and BusyBox's cp silently no-ops on the `src/.` idiom
    # that GNU cp uses to mean "the contents". So tolerate the exit code and
    # verify the outcome instead: every source file must exist at the
    # destination afterwards.
    docker exec "$cid" sh -c "mkdir -p '$dst' && cp -an '$src'/. '$dst'/ 2>/dev/null || true"

    missing=$(docker exec "$cid" sh -c "
      cd '$src' || exit 0
      for f in * .[!.]*; do
        [ -f \"\$f\" ] || continue
        [ \"\$f\" = .gitignore ] && continue
        [ -f '$dst'/\"\$f\" ] || echo \"\$f\"
      done
    " 2>/dev/null | grep -c . || true)
    missing=${missing:-0}

    if [ "$missing" -ne 0 ]; then
      echo "  $src -> $dst : FAILED — $missing of $n file(s) did not copy." >&2
      echo "" >&2
      echo "[migrate-media] ABORTING. Do NOT upgrade $project: the files still" >&2
      echo "  live only in the container layer, and the upgrade's recreate" >&2
      echo "  destroys them permanently — they are on no volume and in no" >&2
      echo "  backup. Resolve the copy failure above, then re-run." >&2
      exit 1
    fi

    after=$(docker exec "$cid" sh -c \
      "find '$dst' -maxdepth 1 -type f ! -name '.gitignore' 2>/dev/null | wc -l" | tr -d '[:space:]')
    echo "  $src -> $dst : $n file(s) verified on the volume (now holds ${after:-0})"
    total_copied=$((total_copied + n))
  done
done

if [ "$DRY_RUN" = "1" ]; then
  echo "[migrate-media] dry run only — nothing was copied."
  exit 0
fi

echo "[migrate-media] done — $total_copied file(s) moved onto the uploads volume."
echo "[migrate-media] the instance is now safe to upgrade to an image that sets MEDIA_DIR."
