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

COPY --from=build /app ./

EXPOSE 3000

# Apply pending migrations (idempotent), then start the API.
CMD ["sh", "-c", "npx prisma migrate deploy --schema packages/db/prisma/schema.prisma && node apps/api/dist/apps/api/src/main.js"]
