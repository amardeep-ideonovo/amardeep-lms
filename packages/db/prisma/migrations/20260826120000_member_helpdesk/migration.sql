-- Member helpdesk: a member <-> admin support channel (guided self-serve front
-- end + escalation into a ticket). Additive only — new enums, new tables, and
-- two new AdminNotificationType values. Safe on a populated instance; rolls
-- back by dropping the tables (the enum values are harmless if unused).

-- CreateEnum
CREATE TYPE "HelpdeskStatus" AS ENUM ('ESCALATED', 'WAITING_ON_MEMBER', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "HelpdeskResolution" AS ENUM ('ANSWERED_BY_ADMIN', 'ABANDONED', 'ADMIN_CLOSED');

-- CreateEnum
CREATE TYPE "HelpdeskAuthorKind" AS ENUM ('MEMBER', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "HelpdeskCategory" AS ENUM ('BILLING', 'ACCESS', 'TECHNICAL', 'CERTIFICATE', 'LIVE_SESSION', 'ACCOUNT', 'OTHER');

-- CreateEnum
CREATE TYPE "HelpdeskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdminNotificationType" ADD VALUE 'HELPDESK_ESCALATED';
ALTER TYPE "AdminNotificationType" ADD VALUE 'HELPDESK_UNANSWERED';

-- CreateTable
CREATE TABLE "HelpdeskConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "HelpdeskStatus" NOT NULL DEFAULT 'ESCALATED',
    "resolution" "HelpdeskResolution",
    "subject" VARCHAR(200) NOT NULL,
    "category" "HelpdeskCategory" NOT NULL DEFAULT 'OTHER',
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "unreadForAdmins" BOOLEAN NOT NULL DEFAULT true,
    "unreadForMember" BOOLEAN NOT NULL DEFAULT false,
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstRespondedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HelpdeskConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelpdeskMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "authorKind" "HelpdeskAuthorKind" NOT NULL,
    "authorAdminId" TEXT,
    "authorName" TEXT,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HelpdeskMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelpdeskAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HelpdeskAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelpdeskTicket" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "priority" "HelpdeskPriority" NOT NULL DEFAULT 'NORMAL',
    "category" "HelpdeskCategory" NOT NULL DEFAULT 'OTHER',
    "escalatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigneeAdminId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HelpdeskTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelpdeskDayStat" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "category" "HelpdeskCategory" NOT NULL,
    "cardViews" INTEGER NOT NULL DEFAULT 0,
    "resolvedYes" INTEGER NOT NULL DEFAULT 0,
    "escalations" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "HelpdeskDayStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelpdeskArticle" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" "HelpdeskCategory" NOT NULL DEFAULT 'OTHER',
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "published" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HelpdeskArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelpdeskSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "greeting" TEXT,
    "replyTimeNote" TEXT,
    "maxOpenPerMember" INTEGER NOT NULL DEFAULT 3,
    "retentionDays" INTEGER NOT NULL DEFAULT 365,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HelpdeskSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HelpdeskConversation_status_lastMessageAt_idx" ON "HelpdeskConversation"("status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "HelpdeskConversation_unreadForAdmins_idx" ON "HelpdeskConversation"("unreadForAdmins");

-- CreateIndex
CREATE INDEX "HelpdeskConversation_userId_lastMessageAt_idx" ON "HelpdeskConversation"("userId", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "HelpdeskMessage_conversationId_seq_key" ON "HelpdeskMessage"("conversationId", "seq");

-- CreateIndex
CREATE INDEX "HelpdeskMessage_conversationId_createdAt_idx" ON "HelpdeskMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "HelpdeskAttachment_fileKey_key" ON "HelpdeskAttachment"("fileKey");

-- CreateIndex
CREATE INDEX "HelpdeskAttachment_messageId_idx" ON "HelpdeskAttachment"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "HelpdeskTicket_conversationId_key" ON "HelpdeskTicket"("conversationId");

-- CreateIndex
CREATE INDEX "HelpdeskTicket_assigneeAdminId_idx" ON "HelpdeskTicket"("assigneeAdminId");

-- CreateIndex
CREATE UNIQUE INDEX "HelpdeskDayStat_day_category_key" ON "HelpdeskDayStat"("day", "category");

-- CreateIndex
CREATE INDEX "HelpdeskDayStat_day_idx" ON "HelpdeskDayStat"("day");

-- CreateIndex
CREATE UNIQUE INDEX "HelpdeskArticle_slug_key" ON "HelpdeskArticle"("slug");

-- CreateIndex
CREATE INDEX "HelpdeskArticle_published_category_sortOrder_idx" ON "HelpdeskArticle"("published", "category", "sortOrder");

-- AddForeignKey
ALTER TABLE "HelpdeskConversation" ADD CONSTRAINT "HelpdeskConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpdeskMessage" ADD CONSTRAINT "HelpdeskMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "HelpdeskConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpdeskAttachment" ADD CONSTRAINT "HelpdeskAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "HelpdeskMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpdeskTicket" ADD CONSTRAINT "HelpdeskTicket_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "HelpdeskConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpdeskTicket" ADD CONSTRAINT "HelpdeskTicket_assigneeAdminId_fkey" FOREIGN KEY ("assigneeAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
