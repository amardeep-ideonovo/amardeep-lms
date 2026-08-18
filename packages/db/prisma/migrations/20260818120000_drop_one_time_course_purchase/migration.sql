-- Remove the one-time (one-off) course purchase feature entirely.
--
-- The UserCourse table was written ONLY by the Stripe one-off purchase flow
-- (grantCoursePurchase, source = STRIPE); there is no manual course-grant path,
-- so dropping the table strands no admin-granted access. This deletes all
-- one-off course purchase rows. UserLevelSource is intentionally kept — it is
-- shared with the UserLevel (subscription/level) table.

-- 1) Drop the course-purchase entitlement table (also removes its FKs, the
--    unique [userId,courseId,source] and its indexes).
DROP TABLE IF EXISTS "UserCourse";

-- 2) Drop the now-unreferenced entitlement status enum.
DROP TYPE IF EXISTS "UserCourseStatus";

-- 3) Drop the one-off price columns from Course (courses remain as content,
--    accessible purely via membership levels).
ALTER TABLE "Course"
  DROP COLUMN IF EXISTS "priceAmount",
  DROP COLUMN IF EXISTS "priceCurrency",
  DROP COLUMN IF EXISTS "priceActive";
