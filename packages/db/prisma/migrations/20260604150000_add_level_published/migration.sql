-- Add a publish flag so the member dashboard lists only real, published classes
-- (and so billing/test levels stay hidden). Defaults to false; the backfill
-- publishes any class that already has landing-page content so existing demos
-- keep showing without a manual toggle.
ALTER TABLE "Level" ADD COLUMN "published" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Level"
SET "published" = true
WHERE "featuredCourseId" IS NOT NULL OR "imageUrl" IS NOT NULL;
