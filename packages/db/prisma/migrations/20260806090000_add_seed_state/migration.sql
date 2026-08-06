-- CreateTable
CREATE TABLE "SeedState" (
    "id" TEXT NOT NULL,
    "demoSeededAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeedState_pkey" PRIMARY KEY ("id")
);
