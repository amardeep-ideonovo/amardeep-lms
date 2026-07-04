-- CreateTable
CREATE TABLE "ChatCanvas" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdByAdminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatCanvas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatCanvas_channelId_position_idx" ON "ChatCanvas"("channelId", "position");

-- AddForeignKey
ALTER TABLE "ChatCanvas" ADD CONSTRAINT "ChatCanvas_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "ChatChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

