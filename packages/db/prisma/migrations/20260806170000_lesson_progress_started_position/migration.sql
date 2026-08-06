-- LessonProgress gains started + resume-position state. completedAt becomes
-- nullable so a single row can represent a started-but-not-completed lesson
-- (previously a row existed only for completed lessons).
ALTER TABLE "LessonProgress"
  ADD COLUMN "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "lastPositionSeconds" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "LessonProgress"
  ALTER COLUMN "completedAt" DROP NOT NULL,
  ALTER COLUMN "completedAt" DROP DEFAULT;

-- Existing rows are all completions; anchor their startedAt to the completion
-- moment rather than the migration run time.
UPDATE "LessonProgress" SET "startedAt" = "completedAt" WHERE "completedAt" IS NOT NULL;
