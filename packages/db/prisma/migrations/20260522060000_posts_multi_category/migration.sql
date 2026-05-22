-- Move Post<->PostCategory from a single FK (Post.categoryId) to an implicit
-- many-to-many relation (_PostToPostCategory). Existing single-category
-- assignments are copied into the join table BEFORE the column is dropped, so
-- no data is lost.

-- CreateTable
CREATE TABLE "_PostToPostCategory" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_PostToPostCategory_AB_unique" ON "_PostToPostCategory"("A", "B");

-- CreateIndex
CREATE INDEX "_PostToPostCategory_B_index" ON "_PostToPostCategory"("B");

-- AddForeignKey
ALTER TABLE "_PostToPostCategory" ADD CONSTRAINT "_PostToPostCategory_A_fkey" FOREIGN KEY ("A") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PostToPostCategory" ADD CONSTRAINT "_PostToPostCategory_B_fkey" FOREIGN KEY ("B") REFERENCES "PostCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data migration: preserve existing single-category links (A = Post.id, B = PostCategory.id).
INSERT INTO "_PostToPostCategory" ("A", "B")
SELECT "id", "categoryId" FROM "Post" WHERE "categoryId" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "Post" DROP CONSTRAINT "Post_categoryId_fkey";

-- DropIndex
DROP INDEX "Post_categoryId_idx";

-- AlterTable
ALTER TABLE "Post" DROP COLUMN "categoryId";
