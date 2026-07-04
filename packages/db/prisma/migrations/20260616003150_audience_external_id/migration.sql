-- AlterTable
ALTER TABLE "Audience" ADD COLUMN     "externalId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Audience_externalId_key" ON "Audience"("externalId");

