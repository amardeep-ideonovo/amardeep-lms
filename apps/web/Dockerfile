# Container image for the Next.js MEMBER web app (@lms/web).
# Build context is the REPO ROOT so the npm workspace resolves:
#   docker build -f apps/web/Dockerfile \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.example.com -t lms-web .
#
# IMPORTANT: NEXT_PUBLIC_API_URL is baked in at BUILD time — Next.js inlines
# NEXT_PUBLIC_* into the client bundle. It MUST be the public https URL of the
# API (e.g. https://api.example.com), not localhost.

# ---------- build ----------
FROM node:20-slim AS build
WORKDIR /app

# Copy the full workspace manifest set first so `npm ci` can resolve workspaces
# (this layer is cached until a package.json changes).
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

# Bake the public API URL into the client bundle, then build.
ARG NEXT_PUBLIC_API_URL=http://localhost:3000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run -w @lms/web build

# ---------- runtime ----------
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3002
# `npm run -w @lms/web start` runs `next start -p 3002` with cwd = apps/web.
CMD ["npm", "run", "-w", "@lms/web", "start"]
