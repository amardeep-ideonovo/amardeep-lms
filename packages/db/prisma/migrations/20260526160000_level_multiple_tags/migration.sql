-- Replace the single per-level Mailchimp tag with a list of tags, preserving
-- any existing value by moving it into a one-element array.
ALTER TABLE "Level" ADD COLUMN "mailchimpTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "Level"
SET "mailchimpTags" = ARRAY["mailchimpTag"]
WHERE "mailchimpTag" IS NOT NULL AND "mailchimpTag" <> '';

ALTER TABLE "Level" DROP COLUMN "mailchimpTag";
