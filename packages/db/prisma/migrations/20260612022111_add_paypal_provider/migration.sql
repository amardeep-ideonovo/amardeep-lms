-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('STRIPE', 'PAYPAL');

-- AlterEnum
ALTER TYPE "UserLevelSource" ADD VALUE 'PAYPAL';

-- AlterTable
ALTER TABLE "Level" ADD COLUMN     "paypalProductId" TEXT;

-- AlterTable
ALTER TABLE "Price" ADD COLUMN     "paypalPlanId" TEXT,
ALTER COLUMN "stripePriceId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "SubscriptionMirror" ADD COLUMN     "priceId" TEXT,
ADD COLUMN     "provider" "PaymentProvider" NOT NULL DEFAULT 'STRIPE',
ADD COLUMN     "userId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Price_paypalPlanId_key" ON "Price"("paypalPlanId");

-- CreateIndex
CREATE INDEX "SubscriptionMirror_provider_idx" ON "SubscriptionMirror"("provider");

-- CreateIndex
CREATE INDEX "SubscriptionMirror_userId_idx" ON "SubscriptionMirror"("userId");
