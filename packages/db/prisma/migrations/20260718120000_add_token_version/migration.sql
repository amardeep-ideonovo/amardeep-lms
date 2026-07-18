-- Session-revocation counter: bumped on password change/reset so live JWTs
-- (which carry the old value) are rejected by JwtStrategy. Additive + defaulted,
-- so existing rows backfill to 0 and tokens minted before this ship (no tv
-- claim, treated as 0) keep working — no fleet-wide forced logout.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Admin" ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 0;
