-- CreateTable
CREATE TABLE "PushReceipt" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "expoPushToken" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "checkAfter" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushReceipt_receiptId_key" ON "PushReceipt"("receiptId");

-- CreateIndex
CREATE INDEX "PushReceipt_status_checkAfter_idx" ON "PushReceipt"("status", "checkAfter");

