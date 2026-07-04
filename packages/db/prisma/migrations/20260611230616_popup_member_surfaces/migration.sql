-- AlterTable
ALTER TABLE "Popup" ADD COLUMN     "showOnClasses" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "showOnCourses" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "showOnLessons" BOOLEAN NOT NULL DEFAULT false;
