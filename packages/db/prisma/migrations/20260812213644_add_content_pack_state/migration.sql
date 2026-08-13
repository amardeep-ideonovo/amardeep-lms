-- CreateTable
CREATE TABLE "ContentPackState" (
    "id" TEXT NOT NULL,
    "packVersion" INTEGER NOT NULL DEFAULT 0,
    "packLabel" TEXT,
    "sourceOrigin" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentPackState_pkey" PRIMARY KEY ("id")
);
