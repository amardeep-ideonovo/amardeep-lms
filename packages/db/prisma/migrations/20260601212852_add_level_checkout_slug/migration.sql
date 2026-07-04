-- AlterTable
ALTER TABLE "Level" ADD COLUMN "slug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Level_slug_key" ON "Level"("slug");
