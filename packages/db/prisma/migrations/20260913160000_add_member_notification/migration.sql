-- CreateTable
CREATE TABLE "MemberNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MemberNotification_dedupeKey_key" ON "MemberNotification"("dedupeKey");

-- CreateIndex
CREATE INDEX "MemberNotification_userId_readAt_idx" ON "MemberNotification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "MemberNotification_userId_createdAt_idx" ON "MemberNotification"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "MemberNotification" ADD CONSTRAINT "MemberNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

