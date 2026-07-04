-- CreateEnum
CREATE TYPE "LiveProvider" AS ENUM ('ZOOM', 'GOOGLE_MEET');

-- CreateEnum
CREATE TYPE "LiveAudience" AS ENUM ('ALL_ACTIVE', 'LEVELS');

-- CreateEnum
CREATE TYPE "LiveSessionStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'CANCELED');

-- CreateTable
CREATE TABLE "LiveSession" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "provider" "LiveProvider" NOT NULL,
    "audience" "LiveAudience" NOT NULL DEFAULT 'LEVELS',
    "status" "LiveSessionStatus" NOT NULL DEFAULT 'DRAFT',
    "joinUrlEnc" TEXT NOT NULL,
    "passwordEnc" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 60,
    "joinLeadMin" INTEGER NOT NULL DEFAULT 10,
    "timezone" TEXT,
    "reminderSentAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveSessionTarget" (
    "liveSessionId" TEXT NOT NULL,
    "levelId" TEXT NOT NULL,

    CONSTRAINT "LiveSessionTarget_pkey" PRIMARY KEY ("liveSessionId","levelId")
);

-- CreateTable
CREATE TABLE "LiveJoinAudit" (
    "id" TEXT NOT NULL,
    "liveSessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveJoinAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LiveSession_status_endsAt_idx" ON "LiveSession"("status", "endsAt");

-- CreateIndex
CREATE INDEX "LiveSessionTarget_levelId_idx" ON "LiveSessionTarget"("levelId");

-- CreateIndex
CREATE INDEX "LiveJoinAudit_liveSessionId_at_idx" ON "LiveJoinAudit"("liveSessionId", "at");

-- CreateIndex
CREATE INDEX "LiveJoinAudit_userId_at_idx" ON "LiveJoinAudit"("userId", "at");

-- AddForeignKey
ALTER TABLE "LiveSession" ADD CONSTRAINT "LiveSession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveSessionTarget" ADD CONSTRAINT "LiveSessionTarget_liveSessionId_fkey" FOREIGN KEY ("liveSessionId") REFERENCES "LiveSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveSessionTarget" ADD CONSTRAINT "LiveSessionTarget_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveJoinAudit" ADD CONSTRAINT "LiveJoinAudit_liveSessionId_fkey" FOREIGN KEY ("liveSessionId") REFERENCES "LiveSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
