-- CreateEnum
CREATE TYPE "ScheduledEmailStatus" AS ENUM ('PENDING', 'SENT', 'CANCELED', 'FAILED');

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "timezone" TEXT;

-- CreateTable
CREATE TABLE "ScheduledEmail" (
    "id" TEXT NOT NULL,
    "automationId" TEXT,
    "to" TEXT NOT NULL,
    "templateId" TEXT,
    "templateKey" TEXT,
    "vars" JSONB NOT NULL,
    "sendAt" TIMESTAMP(3) NOT NULL,
    "status" "ScheduledEmailStatus" NOT NULL DEFAULT 'PENDING',
    "dedupeKey" TEXT,
    "contactId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "ScheduledEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledEmail_dedupeKey_key" ON "ScheduledEmail"("dedupeKey");

-- CreateIndex
CREATE INDEX "ScheduledEmail_status_sendAt_idx" ON "ScheduledEmail"("status", "sendAt");

