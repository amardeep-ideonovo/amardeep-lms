/*
  Warnings:

  - You are about to drop the `SiteConfig` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "SiteConfig";

-- CreateTable
CREATE TABLE "Header" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "conditions" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Header_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Header_enabled_priority_idx" ON "Header"("enabled", "priority");
