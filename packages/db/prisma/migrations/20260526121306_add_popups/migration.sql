-- CreateEnum
CREATE TYPE "PopupStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "PopupPosition" AS ENUM ('CENTER', 'TOP', 'BOTTOM', 'TOP_LEFT', 'TOP_RIGHT', 'BOTTOM_LEFT', 'BOTTOM_RIGHT');

-- CreateEnum
CREATE TYPE "PopupPageMode" AS ENUM ('NONE', 'ALL', 'INCLUDE', 'EXCLUDE');

-- CreateTable
CREATE TABLE "Popup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "status" "PopupStatus" NOT NULL DEFAULT 'INACTIVE',
    "width" TEXT NOT NULL DEFAULT '480px',
    "height" TEXT NOT NULL DEFAULT 'auto',
    "background" TEXT NOT NULL DEFAULT '#ffffff',
    "position" "PopupPosition" NOT NULL DEFAULT 'CENTER',
    "borderColor" TEXT NOT NULL DEFAULT '#e2e8f0',
    "borderRadius" INTEGER NOT NULL DEFAULT 12,
    "padding" INTEGER NOT NULL DEFAULT 24,
    "showOnDashboard" BOOLEAN NOT NULL DEFAULT false,
    "pageMode" "PopupPageMode" NOT NULL DEFAULT 'NONE',
    "pageIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Popup_pkey" PRIMARY KEY ("id")
);
