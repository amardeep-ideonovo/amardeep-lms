-- AlterTable
ALTER TABLE "Lesson" ADD COLUMN     "durationSeconds" INTEGER;

-- AlterTable
ALTER TABLE "Level" ADD COLUMN     "description" TEXT,
ADD COLUMN     "featuredCourseId" TEXT,
ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "skills" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "trailerUrl" TEXT;

-- AddForeignKey
ALTER TABLE "Level" ADD CONSTRAINT "Level_featuredCourseId_fkey" FOREIGN KEY ("featuredCourseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;
