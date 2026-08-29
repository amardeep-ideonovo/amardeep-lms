-- Member close-own-request + once-per-resolution CSAT (all additive).

-- AlterEnum
ALTER TYPE "HelpdeskResolution" ADD VALUE 'MEMBER_RESOLVED';

-- AlterTable
ALTER TABLE "HelpdeskConversation"
  ADD COLUMN "satisfactionUp" BOOLEAN,
  ADD COLUMN "satisfactionNote" VARCHAR(500),
  ADD COLUMN "satisfactionAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "HelpdeskDayStat"
  ADD COLUMN "ratedUp" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "ratedDown" INTEGER NOT NULL DEFAULT 0;
