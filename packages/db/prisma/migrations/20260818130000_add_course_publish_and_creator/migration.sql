-- Course Draft/Published state + "created by" admin on classes and courses.

-- 1) Course.published — members only ever see published courses. Backfill
--    existing courses that already have lessons to published=true (preserve
--    current visibility); lessonless courses stay drafts, matching the new rule
--    that a course needs >=1 lesson to be published.
ALTER TABLE "Course" ADD COLUMN "published" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Course" c SET "published" = true
  WHERE EXISTS (SELECT 1 FROM "Lesson" l WHERE l."courseId" = c."id");

-- 2) createdById on Level + Course — the Admin who created it (audit only).
--    SET NULL on admin delete so removing an admin never deletes their content.
ALTER TABLE "Level" ADD COLUMN "createdById" TEXT;
ALTER TABLE "Course" ADD COLUMN "createdById" TEXT;

ALTER TABLE "Level" ADD CONSTRAINT "Level_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Course" ADD CONSTRAINT "Course_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
