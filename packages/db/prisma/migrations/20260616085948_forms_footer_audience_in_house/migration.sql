-- Forms + Footer audience cutover to the in-house Audience system.
-- Hand-edited to be SAFE + data-preserving (backfill before drop, rename in place).

-- Form: add the in-house Audience FK column, backfill from the old Mailchimp list
-- id (via Audience.externalId), then drop the legacy Mailchimp columns. Mailchimp
-- list ids with no matching Audience stay null = the default "Members" audience.
ALTER TABLE "Form" ADD COLUMN "audienceId" TEXT;

UPDATE "Form" f
SET "audienceId" = a.id
FROM "Audience" a
WHERE a."externalId" = f."mailchimpAudienceId";

ALTER TABLE "Form" DROP COLUMN "mailchimpAudienceId";
ALTER TABLE "Form" DROP COLUMN "mailchimpAudienceName";

-- FormSubmission: rename status column in place (preserve existing values).
ALTER TABLE "FormSubmission" RENAME COLUMN "mailchimpStatus" TO "subscribeStatus";

-- FK + index for Form.audienceId.
ALTER TABLE "Form" ADD CONSTRAINT "Form_audienceId_fkey" FOREIGN KEY ("audienceId") REFERENCES "Audience"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Form_audienceId_idx" ON "Form"("audienceId");
