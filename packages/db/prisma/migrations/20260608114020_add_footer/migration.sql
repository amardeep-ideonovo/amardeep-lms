-- CreateTable
CREATE TABLE "Footer" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "config" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Footer_pkey" PRIMARY KEY ("id")
);
