-- CreateEnum
CREATE TYPE "ContactStatus" AS ENUM ('SUBSCRIBED', 'PENDING', 'UNSUBSCRIBED', 'CLEANED');

-- CreateEnum
CREATE TYPE "ContactSource" AS ENUM ('SIGNUP', 'FORM', 'FOOTER', 'IMPORT', 'MANUAL', 'ADMIN');

-- CreateEnum
CREATE TYPE "ConsentKind" AS ENUM ('OPTIN', 'CONFIRM', 'UNSUBSCRIBE', 'COMPLAINT', 'CLEANED');

-- CreateTable
CREATE TABLE "Audience" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Audience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AudienceField" (
    "id" TEXT NOT NULL,
    "audienceId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'text',
    "required" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AudienceField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "audienceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" "ContactStatus" NOT NULL DEFAULT 'SUBSCRIBED',
    "firstName" TEXT,
    "lastName" TEXT,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" "ContactSource" NOT NULL DEFAULT 'MANUAL',
    "userId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "unsubscribedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Segment" (
    "id" TEXT NOT NULL,
    "audienceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filter" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Segment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentEvent" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "kind" "ConsentKind" NOT NULL,
    "source" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Audience_slug_key" ON "Audience"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "AudienceField_audienceId_tag_key" ON "AudienceField"("audienceId", "tag");

-- CreateIndex
CREATE INDEX "Contact_audienceId_status_idx" ON "Contact"("audienceId", "status");

-- CreateIndex
CREATE INDEX "Contact_userId_idx" ON "Contact"("userId");

-- CreateIndex
CREATE INDEX "Contact_email_idx" ON "Contact"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_audienceId_email_key" ON "Contact"("audienceId", "email");

-- CreateIndex
CREATE INDEX "Segment_audienceId_idx" ON "Segment"("audienceId");

-- CreateIndex
CREATE INDEX "ConsentEvent_contactId_idx" ON "ConsentEvent"("contactId");

-- AddForeignKey
ALTER TABLE "AudienceField" ADD CONSTRAINT "AudienceField_audienceId_fkey" FOREIGN KEY ("audienceId") REFERENCES "Audience"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_audienceId_fkey" FOREIGN KEY ("audienceId") REFERENCES "Audience"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Segment" ADD CONSTRAINT "Segment_audienceId_fkey" FOREIGN KEY ("audienceId") REFERENCES "Audience"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentEvent" ADD CONSTRAINT "ConsentEvent_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

