-- CreateTable
CREATE TABLE "PushOutbox" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "levelIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "broadcast" BOOLEAN NOT NULL DEFAULT false,
    "dedupePrefix" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sendAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "PushOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushOutbox_dedupePrefix_key" ON "PushOutbox"("dedupePrefix");

-- CreateIndex
CREATE INDEX "PushOutbox_status_sendAt_idx" ON "PushOutbox"("status", "sendAt");

