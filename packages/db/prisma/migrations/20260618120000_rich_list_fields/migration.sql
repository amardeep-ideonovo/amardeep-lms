-- CreateEnum
CREATE TYPE "ChatFieldType" AS ENUM ('TEXT', 'LONG_TEXT', 'SELECT', 'MULTI_SELECT', 'PERSON', 'DATE', 'URL', 'NUMBER', 'CHECKBOX', 'SECRET');

-- AlterTable
ALTER TABLE "ChatList" ADD COLUMN     "description" TEXT,
ADD COLUMN     "icon" TEXT,
ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ChatListItem" ADD COLUMN     "values" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "ChatListField" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ChatFieldType" NOT NULL DEFAULT 'TEXT',
    "options" JSONB NOT NULL DEFAULT '[]',
    "config" JSONB NOT NULL DEFAULT '{}',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatListField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatListItemComment" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "authorAdminId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ChatListItemComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatListField_listId_position_idx" ON "ChatListField"("listId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ChatListField_listId_key_key" ON "ChatListField"("listId", "key");

-- CreateIndex
CREATE INDEX "ChatListItemComment_itemId_idx" ON "ChatListItemComment"("itemId");

-- AddForeignKey
ALTER TABLE "ChatListField" ADD CONSTRAINT "ChatListField_listId_fkey" FOREIGN KEY ("listId") REFERENCES "ChatList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatListItemComment" ADD CONSTRAINT "ChatListItemComment_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ChatListItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

