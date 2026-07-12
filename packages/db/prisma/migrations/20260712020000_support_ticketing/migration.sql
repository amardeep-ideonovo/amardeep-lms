-- CreateEnum
CREATE TYPE "SupportStatus" AS ENUM ('OPEN', 'PENDING', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SupportPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "SupportLane" AS ENUM ('MAIN', 'OPS');

-- CreateEnum
CREATE TYPE "SupportAuthorKind" AS ENUM ('ADMIN', 'CLIENT', 'OPERATOR', 'SYSTEM');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdminNotificationType" ADD VALUE 'SUPPORT_REPLY';
ALTER TYPE "AdminNotificationType" ADD VALUE 'SUPPORT_STATUS';
ALTER TYPE "AdminNotificationType" ADD VALUE 'SUPPORT_INVITED_OPS';

-- AlterTable
ALTER TABLE "AdminNotification" ADD COLUMN     "entityId" TEXT,
ADD COLUMN     "entityType" TEXT;

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "remoteId" TEXT,
    "raiserAdminId" TEXT,
    "raiserAdminEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "priority" "SupportPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "SupportStatus" NOT NULL DEFAULT 'OPEN',
    "ownerTier" TEXT,
    "adminInOpsLane" BOOLEAN NOT NULL DEFAULT false,
    "csatPromptedAt" TIMESTAMP(3),
    "csatRating" INTEGER,
    "csatSubmittedAt" TIMESTAMP(3),
    "unreadForAdmins" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportMessage" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "remoteId" TEXT,
    "lane" "SupportLane" NOT NULL,
    "authorKind" "SupportAuthorKind" NOT NULL,
    "authorEmail" TEXT NOT NULL,
    "authorName" TEXT,
    "body" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportSyncState" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "lastPulledAt" TIMESTAMP(3) NOT NULL DEFAULT '1970-01-01 00:00:00 +00:00',

    CONSTRAINT "SupportSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupportTicket_remoteId_key" ON "SupportTicket"("remoteId");

-- CreateIndex
CREATE INDEX "SupportTicket_status_lastMessageAt_idx" ON "SupportTicket"("status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "SupportTicket_unreadForAdmins_idx" ON "SupportTicket"("unreadForAdmins");

-- CreateIndex
CREATE UNIQUE INDEX "SupportMessage_remoteId_key" ON "SupportMessage"("remoteId");

-- CreateIndex
CREATE INDEX "SupportMessage_ticketId_createdAt_idx" ON "SupportMessage"("ticketId", "createdAt");

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

