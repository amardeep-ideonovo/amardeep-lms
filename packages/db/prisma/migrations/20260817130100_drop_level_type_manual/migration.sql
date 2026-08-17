-- Remove LevelType.MANUAL. Access lives in UserLevel rows (not derived from
-- Level.type), so re-typing a class grants/removes nothing — existing members
-- keep access. A former MANUAL class becomes PAID with no Price rows, i.e.
-- simply not purchasable (admins still hand-grant it via Members). Converting to
-- FREE would be WRONG: FREE auto-enrolls every member on publish/signup.

-- 1) Move existing MANUAL classes off the value BEFORE the cast (or the enum
--    recreation's USING cast would fail on the MANUAL rows).
UPDATE "Level" SET "type" = 'PAID' WHERE "type" = 'MANUAL';

-- 2) Recreate the enum without MANUAL (Postgres can't ALTER TYPE ... DROP VALUE).
--    Drop + re-add the column default around the cast.
ALTER TYPE "LevelType" RENAME TO "LevelType_old";
CREATE TYPE "LevelType" AS ENUM ('PAID', 'FREE');
ALTER TABLE "Level" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "Level" ALTER COLUMN "type" TYPE "LevelType" USING ("type"::text::"LevelType");
ALTER TABLE "Level" ALTER COLUMN "type" SET DEFAULT 'PAID';
DROP TYPE "LevelType_old";
