-- Synthetic per-instance "preview member" support (admin no-account site preview).
-- Two hidden read-only identities discriminated by previewMode ("locked"|"unlocked").
-- AlterTable
ALTER TABLE "User" ADD COLUMN "isPreview" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "previewMode" TEXT;
