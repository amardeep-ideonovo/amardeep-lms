-- CreateEnum
CREATE TYPE "ChatChannelKind" AS ENUM ('CHANNEL', 'DM', 'GROUP_DM');

-- CreateEnum
CREATE TYPE "ChatWorkflowTrigger" AS ENUM ('ITEM_CREATED', 'ITEM_ASSIGNED', 'ITEM_UPDATED');

-- AlterTable
ALTER TABLE "ChatChannel" ADD COLUMN     "dmKey" TEXT,
ADD COLUMN     "kind" "ChatChannelKind" NOT NULL DEFAULT 'CHANNEL';

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "listItemId" TEXT,
ADD COLUMN     "workflowId" TEXT;

-- CreateTable
CREATE TABLE "ChatWorkflow" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "channelId" TEXT,
    "trigger" "ChatWorkflowTrigger" NOT NULL DEFAULT 'ITEM_CREATED',
    "config" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdByAdminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatWorkflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatWorkflowRun" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "messageId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OK',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatWorkflowRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatWorkflow_listId_idx" ON "ChatWorkflow"("listId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatWorkflowRun_dedupeKey_key" ON "ChatWorkflowRun"("dedupeKey");

-- CreateIndex
CREATE INDEX "ChatWorkflowRun_workflowId_idx" ON "ChatWorkflowRun"("workflowId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatChannel_dmKey_key" ON "ChatChannel"("dmKey");

-- CreateIndex
CREATE INDEX "ChatMessage_listItemId_idx" ON "ChatMessage"("listItemId");

-- AddForeignKey
ALTER TABLE "ChatWorkflow" ADD CONSTRAINT "ChatWorkflow_listId_fkey" FOREIGN KEY ("listId") REFERENCES "ChatList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatWorkflowRun" ADD CONSTRAINT "ChatWorkflowRun_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "ChatWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

