-- CreateEnum
CREATE TYPE "EmailEventType" AS ENUM ('DELIVERED', 'OPEN', 'CLICK', 'BOUNCE', 'COMPLAINT');

-- CreateTable
CREATE TABLE "EmailEvent" (
    "id" TEXT NOT NULL,
    "emailLogId" TEXT,
    "providerId" TEXT,
    "type" "EmailEventType" NOT NULL,
    "email" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailEvent_emailLogId_idx" ON "EmailEvent"("emailLogId");

-- CreateIndex
CREATE INDEX "EmailEvent_providerId_idx" ON "EmailEvent"("providerId");

