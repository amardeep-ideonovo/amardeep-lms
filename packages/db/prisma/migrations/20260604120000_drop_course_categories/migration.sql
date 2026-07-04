-- Remove the course "Category" feature entirely (course categories are no
-- longer used). This drops the assignment column and the table, so any existing
-- category data is cleaned up automatically on deploy.
--
-- NOTE: the blog's "PostCategory" is a SEPARATE model and is intentionally
-- untouched.

-- Drop the FK + assignment column on Course first, then the table.
ALTER TABLE "Course" DROP CONSTRAINT IF EXISTS "Course_categoryId_fkey";
ALTER TABLE "Course" DROP COLUMN IF EXISTS "categoryId";
DROP TABLE IF EXISTS "Category";
