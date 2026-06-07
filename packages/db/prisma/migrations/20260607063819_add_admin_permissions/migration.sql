-- AlterTable
ALTER TABLE "Admin" ADD COLUMN     "permissions" JSONB NOT NULL DEFAULT '{}';
