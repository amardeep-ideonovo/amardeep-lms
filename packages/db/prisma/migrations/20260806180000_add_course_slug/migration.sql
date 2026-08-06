-- Courses get a readable URL slug (auto-derived from title), addressable at
-- /courses/<slug>. Nullable + unique: existing rows stay NULL (Postgres treats
-- NULLs as distinct, so many are allowed) and receive a slug on their next save.
ALTER TABLE "Course" ADD COLUMN "slug" TEXT;
CREATE UNIQUE INDEX "Course_slug_key" ON "Course"("slug");
