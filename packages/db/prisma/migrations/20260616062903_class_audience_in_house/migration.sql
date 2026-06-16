-- Cutover: a class (Level) now links to an IN-HOUSE Audience, not a Mailchimp list.
-- Hand-edited (not raw prisma migrate diff) to be SAFE + data-preserving:
--   * rename mailchimpTags -> audienceTags in place (preserve the tag arrays)
--   * add audienceId and backfill from Audience.externalId match before dropping
--     the old Mailchimp columns (the dev values are fake list ids that match
--     nothing, so they correctly resolve to NULL = the default "Members" audience)

-- Preserve tag arrays: rename in place rather than drop + add.
ALTER TABLE "Level" RENAME COLUMN "mailchimpTags" TO "audienceTags";

-- New in-house audience link.
ALTER TABLE "Level" ADD COLUMN "audienceId" TEXT;

-- Backfill from any Audience whose externalId matches the old Mailchimp list id.
-- (Fake aud_123 fixtures match nothing -> stay NULL, which is correct: NULL means
-- the default "Members" audience at grant time.)
UPDATE "Level" l SET "audienceId" = a.id
FROM "Audience" a
WHERE a."externalId" = l."mailchimpAudienceId";

-- Drop the now-unused Mailchimp columns (values were Mailchimp list ids, not ours).
ALTER TABLE "Level" DROP COLUMN "mailchimpAudienceId";
ALTER TABLE "Level" DROP COLUMN "mailchimpAudienceName";

-- AddForeignKey
ALTER TABLE "Level" ADD CONSTRAINT "Level_audienceId_fkey" FOREIGN KEY ("audienceId") REFERENCES "Audience"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Level_audienceId_idx" ON "Level"("audienceId");
