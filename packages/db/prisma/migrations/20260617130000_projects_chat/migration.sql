-- CreateEnum
CREATE TYPE "ChatListItemStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE');

-- CreateTable
CREATE TABLE "ChatChannel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "topic" TEXT,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "createdByAdminId" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMember" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "lastReadSeq" INTEGER NOT NULL DEFAULT 0,
    "lastReadAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "channelId" TEXT NOT NULL,
    "authorAdminId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "parentMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatReaction" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatReaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMention" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "mentionedAdminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatList" (
    "id" TEXT NOT NULL,
    "channelId" TEXT,
    "name" TEXT NOT NULL,
    "createdByAdminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatListItem" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ChatListItemStatus" NOT NULL DEFAULT 'TODO',
    "assigneeAdminId" TEXT,
    "dueDate" TIMESTAMP(3),
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdFromMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatListItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatChannel_slug_key" ON "ChatChannel"("slug");

-- CreateIndex
CREATE INDEX "ChatMember_adminId_idx" ON "ChatMember"("adminId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMember_channelId_adminId_key" ON "ChatMember"("channelId", "adminId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessage_seq_key" ON "ChatMessage"("seq");

-- CreateIndex
CREATE INDEX "ChatMessage_channelId_seq_idx" ON "ChatMessage"("channelId", "seq");

-- CreateIndex
CREATE INDEX "ChatMessage_parentMessageId_idx" ON "ChatMessage"("parentMessageId");

-- CreateIndex
CREATE INDEX "ChatReaction_messageId_idx" ON "ChatReaction"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatReaction_messageId_adminId_emoji_key" ON "ChatReaction"("messageId", "adminId", "emoji");

-- CreateIndex
CREATE INDEX "ChatMention_mentionedAdminId_idx" ON "ChatMention"("mentionedAdminId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMention_messageId_mentionedAdminId_key" ON "ChatMention"("messageId", "mentionedAdminId");

-- CreateIndex
CREATE INDEX "ChatList_channelId_idx" ON "ChatList"("channelId");

-- CreateIndex
CREATE INDEX "ChatListItem_listId_position_idx" ON "ChatListItem"("listId", "position");

-- CreateIndex
CREATE INDEX "ChatListItem_assigneeAdminId_idx" ON "ChatListItem"("assigneeAdminId");

-- AddForeignKey
ALTER TABLE "ChatMember" ADD CONSTRAINT "ChatMember_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "ChatChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "ChatChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_parentMessageId_fkey" FOREIGN KEY ("parentMessageId") REFERENCES "ChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatReaction" ADD CONSTRAINT "ChatReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMention" ADD CONSTRAINT "ChatMention_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatList" ADD CONSTRAINT "ChatList_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "ChatChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatListItem" ADD CONSTRAINT "ChatListItem_listId_fkey" FOREIGN KEY ("listId") REFERENCES "ChatList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatListItem" ADD CONSTRAINT "ChatListItem_createdFromMessageId_fkey" FOREIGN KEY ("createdFromMessageId") REFERENCES "ChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

