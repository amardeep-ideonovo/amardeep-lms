-- Add PAUSED to the status enums. PAUSED suspends access but is resumable
-- (unlike CANCELED). Safe inside the migration transaction on PG12+ because the
-- new value is not USED by any statement in this same migration.
ALTER TYPE "UserLevelStatus" ADD VALUE IF NOT EXISTS 'PAUSED';
ALTER TYPE "SubStatus" ADD VALUE IF NOT EXISTS 'PAUSED';

-- Installment plans: bill N times then convert the grant to lifetime.
ALTER TABLE "Price" ADD COLUMN "installments" INTEGER;

-- Permanent (lifetime) grants are never revoked by Stripe reconciliation.
ALTER TABLE "UserLevel" ADD COLUMN "lifetime" BOOLEAN NOT NULL DEFAULT false;
