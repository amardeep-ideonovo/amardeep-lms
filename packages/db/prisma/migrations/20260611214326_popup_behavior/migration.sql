-- CreateEnum
CREATE TYPE "PopupTrigger" AS ENUM ('IMMEDIATE', 'DELAY', 'SCROLL', 'EXIT_INTENT');

-- CreateEnum
CREATE TYPE "PopupFrequency" AS ENUM ('EVERY_VISIT', 'ONCE_PER_SESSION', 'ONCE_PER_DAYS', 'ONCE');

-- CreateEnum
CREATE TYPE "PopupAnimation" AS ENUM ('NONE', 'FADE', 'SLIDE_UP', 'ZOOM');

-- AlterTable
ALTER TABLE "Popup" ADD COLUMN     "animation" "PopupAnimation" NOT NULL DEFAULT 'FADE',
ADD COLUMN     "closeOnOverlay" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "frequency" "PopupFrequency" NOT NULL DEFAULT 'EVERY_VISIT',
ADD COLUMN     "frequencyDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "trigger" "PopupTrigger" NOT NULL DEFAULT 'IMMEDIATE',
ADD COLUMN     "triggerValue" INTEGER NOT NULL DEFAULT 0;
