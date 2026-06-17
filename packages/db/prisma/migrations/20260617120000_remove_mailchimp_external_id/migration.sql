-- Remove the now-unused Audience.externalId column (formerly the external list
-- id used during the Mailchimp dual-write/import phase). Mailchimp has been
-- fully decommissioned; audiences are resolved by internal id only.

-- DropIndex
DROP INDEX "Audience_externalId_key";

-- AlterTable
ALTER TABLE "Audience" DROP COLUMN "externalId";
