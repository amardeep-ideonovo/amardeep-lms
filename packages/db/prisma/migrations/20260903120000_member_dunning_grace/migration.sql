-- Member dunning grace + failed-payment email.
--
-- Additive only: one new AutomationTrigger enum value used by the seeded
-- PAYMENT_FAILED dunning automation. A single ADD VALUE appends to the enum and
-- is safe on a populated instance (harmless if unused). The grace window itself
-- reuses the existing UserLevel.expiresAt column (no schema change), so a failed
-- renewal keeps access for a short window instead of cutting it off instantly.

-- AlterEnum
ALTER TYPE "AutomationTrigger" ADD VALUE 'PAYMENT_FAILED';
