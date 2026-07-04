-- CreateEnum
CREATE TYPE "UserCourseStatus" AS ENUM ('ACTIVE', 'REFUNDED', 'EXPIRED');

-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "priceActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "priceAmount" INTEGER,
ADD COLUMN     "priceCurrency" TEXT NOT NULL DEFAULT 'usd';

-- CreateTable
CREATE TABLE "UserCourse" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "source" "UserLevelSource" NOT NULL DEFAULT 'STRIPE',
    "status" "UserCourseStatus" NOT NULL DEFAULT 'ACTIVE',
    "stripeCheckoutSessionId" TEXT,
    "stripePaymentIntentId" TEXT,
    "amount" INTEGER,
    "currency" TEXT,
    "expiresAt" TIMESTAMP(3),
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserCourse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserCourse_stripeCheckoutSessionId_key" ON "UserCourse"("stripeCheckoutSessionId");

-- CreateIndex
CREATE INDEX "UserCourse_userId_status_idx" ON "UserCourse"("userId", "status");

-- CreateIndex
CREATE INDEX "UserCourse_courseId_idx" ON "UserCourse"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "UserCourse_userId_courseId_source_key" ON "UserCourse"("userId", "courseId", "source");

-- AddForeignKey
ALTER TABLE "UserCourse" ADD CONSTRAINT "UserCourse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCourse" ADD CONSTRAINT "UserCourse_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

