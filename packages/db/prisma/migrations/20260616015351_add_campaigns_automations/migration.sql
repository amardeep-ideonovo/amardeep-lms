-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'PAUSED');

-- CreateEnum
CREATE TYPE "CampaignCadence" AS ENUM ('ONCE', 'WEEKLY', 'MONTHLY', 'CRON');

-- CreateEnum
CREATE TYPE "AutomationTrigger" AS ENUM ('SIGNUP', 'SUBSCRIPTION_ACTIVE', 'SUBSCRIPTION_CANCELED', 'LESSON_COMPLETED', 'CERTIFICATE_ISSUED');

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "audienceId" TEXT NOT NULL,
    "segmentId" TEXT,
    "cadence" "CampaignCadence" NOT NULL DEFAULT 'ONCE',
    "runAt" TIMESTAMP(3),
    "cron" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Automation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" "AutomationTrigger" NOT NULL,
    "templateId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "delayMinutes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Automation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Campaign_status_nextRunAt_idx" ON "Campaign"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "Automation_trigger_active_idx" ON "Automation"("trigger", "active");

