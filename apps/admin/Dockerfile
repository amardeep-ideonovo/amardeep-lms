# Container image for the Next.js ADMIN app (@lms/admin).
# Build context is the REPO ROOT so the npm workspace resolves:
#   docker build -f apps/admin/Dockerfile \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.example.com -t lms-admin .
#
# IMPORTANT: NEXT_PUBLIC_API_URL is baked in at BUILD time (Next.js inlines
# NEXT_PUBLIC_* into the bundle). It MUST be the public https URL of the API.

# ---------- build ----------
FROM node:20-slim AS build
WORKDIR /app

# Copy the full workspace manifest set first so `npm ci` can resolve workspaces.
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

# Bake the public API URL into the bundle, then build.
ARG NEXT_PUBLIC_API_URL=http://localhost:3000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run -w @lms/admin build

# ---------- runtime ----------
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3001
# `npm run -w @lms/admin start` runs `next start -p 3001` with cwd = apps/admin.
CMD ["npm", "run", "-w", "@lms/admin", "start"]
