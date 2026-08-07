-- Multi-location navigation: a menu may occupy several render locations while
-- each location still shows exactly one menu. Moves the single-valued
-- Menu.location scalar to a MenuLocationAssignment join table whose PK is the
-- location (one menu per location), with a non-unique menuId (one menu, many
-- locations). Backfills existing assignments BEFORE dropping the old column.

-- 1. New assignment table (location is the primary key).
CREATE TABLE "MenuLocationAssignment" (
    "location" "MenuLocation" NOT NULL,
    "menuId" TEXT NOT NULL,
    CONSTRAINT "MenuLocationAssignment_pkey" PRIMARY KEY ("location")
);

CREATE INDEX "MenuLocationAssignment_menuId_idx" ON "MenuLocationAssignment"("menuId");

ALTER TABLE "MenuLocationAssignment"
    ADD CONSTRAINT "MenuLocationAssignment_menuId_fkey"
    FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Backfill from the current single-location column (no-op when no menu is
--    assigned). Runs before the column is dropped so no data is lost.
INSERT INTO "MenuLocationAssignment" ("location", "menuId")
SELECT "location", "id" FROM "Menu" WHERE "location" IS NOT NULL;

-- 3. Drop the old unique index + scalar column (dropping the column would drop
--    the index too; IF EXISTS keeps this safe either way).
DROP INDEX IF EXISTS "Menu_location_key";
ALTER TABLE "Menu" DROP COLUMN "location";
