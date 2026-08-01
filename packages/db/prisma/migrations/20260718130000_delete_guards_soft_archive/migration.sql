-- Preserve issued certificates when their class is deleted: Certificate.levelId
-- becomes nullable and its FK goes ON DELETE SET NULL (was CASCADE), so a
-- deleted class no longer destroys the members' verifiable certificate records.
-- Plus soft-archive columns on Level + Course so a populated class/course can be
-- hidden instead of hard-deleted (the API now 409s a delete that would strand
-- paying members or wipe lifetime purchases).

-- DropForeignKey
ALTER TABLE "Certificate" DROP CONSTRAINT "Certificate_levelId_fkey";

-- AlterTable
ALTER TABLE "Certificate" ALTER COLUMN "levelId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Level" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE SET NULL ON UPDATE CASCADE;
