# Container image for the NestJS API. Build context is the REPO ROOT
# (so the npm workspace + Prisma schema are available):
#   docker build -f apps/api/Dockerfile -t lms-api .
# Platforms (Render/Railway/Fly) should set the Dockerfile path to apps/api/Dockerfile
# and the build context to the repo root.

# ---------- build ----------
FROM node:20-slim AS build
WORKDIR /app
# openssl is required by Prisma engines.
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Install with the full workspace manifest set so npm can resolve workspaces.
COPY package.json package-lock.json ./
COPY packages/db/package.json packages/db/
COPY packages/types/package.json packages/types/
COPY packages/bdd/package.json packages/bdd/
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
RUN npm ci

COPY . .
RUN npx prisma generate --schema packages/db/prisma/schema.prisma
RUN npm run -w @lms/api build

# ---------- runtime ----------
FROM node:20-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV PORT=3000

# Where the API keeps files on disk. These MUST be set in the image. Every
# storage dir falls back to a cwd-relative dev default (<cwd>/src/...), and the
# cwd here is /app — so an unset var writes member uploads to /app/src/..., a
# path inside the container layer that is destroyed on the next recreate. The
# app can't tell the difference, so the loss is silent (see storage-dirs.ts).
#
# /data is the per-instance `uploads` volume mounted by
# deploy/instance/docker-compose.instance.yml, which pins these too. The image
# defaults are the belt to compose's braces: instances are recreated with
# whatever compose file is on the host, so an image bump that lands before a
# repo pull would otherwise boot against the fallback.
ENV MEDIA_DIR=/data/media
ENV BLOG_IMAGES_DIR=/data/images
ENV LESSON_FILES_DIR=/data/files
ENV CERT_FILES_DIR=/data/files/certificates

# Read-only repo assets, NOT member data: the TTFs ship in the image, so this
# points into the source tree rather than the volume. The cwd fallback would
# resolve to /app/src/certificates/fonts, which does not exist under Docker —
# the sources live at /app/apps/api/src — and every certificate render would
# throw ENOENT.
ENV CERT_FONTS_DIR=/app/apps/api/src/certificates/fonts

# Version stamp for the app<->API handshake (GET /app/config + /health).
# Set by deploy/instance/build-images.sh; empty means "unstamped dev build".
ARG APP_VERSION=""
ENV APP_VERSION=${APP_VERSION}

COPY --from=build /app ./

EXPOSE 3000

# Apply pending migrations (idempotent), then start the API.
CMD ["sh", "-c", "npx prisma migrate deploy --schema packages/db/prisma/schema.prisma && node apps/api/dist/apps/api/src/main.js"]
