-- Managed blog Tags (replace the free-text Post.tags String[]) + a single
-- Featured hero flag on Post.

-- 1) Tag entity (mirrors PostCategory).
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Tag_slug_key" ON "Tag"("slug");

-- 2) Post <-> Tag implicit many-to-many join (mirrors _PostToPostCategory).
CREATE TABLE "_PostToTag" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);
CREATE UNIQUE INDEX "_PostToTag_AB_unique" ON "_PostToTag"("A", "B");
CREATE INDEX "_PostToTag_B_index" ON "_PostToTag"("B");
ALTER TABLE "_PostToTag" ADD CONSTRAINT "_PostToTag_A_fkey" FOREIGN KEY ("A") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_PostToTag" ADD CONSTRAINT "_PostToTag_B_fkey" FOREIGN KEY ("B") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3) Fold existing free-text Post.tags into managed Tag rows (dedupe by slug,
--    keeping one display name per slug).
INSERT INTO "Tag" ("id", "name", "slug", "order")
SELECT gen_random_uuid()::text, g.name, g.slug, 0
FROM (
  SELECT min(d.name) AS name,
         lower(regexp_replace(regexp_replace(trim(d.name), '[^a-zA-Z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g')) AS slug
  FROM (SELECT DISTINCT unnest("tags") AS name FROM "Post") d
  WHERE trim(d.name) <> ''
  GROUP BY 2
) g
WHERE g.slug <> '';

-- 4) Link each post to its (now managed) tags, matched by slug.
INSERT INTO "_PostToTag" ("A", "B")
SELECT p."id", t."id"
FROM "Post" p
CROSS JOIN LATERAL unnest(p."tags") AS pt(name)
JOIN "Tag" t ON t."slug" = lower(regexp_replace(regexp_replace(trim(pt.name), '[^a-zA-Z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'))
WHERE trim(pt.name) <> ''
ON CONFLICT DO NOTHING;

-- 5) Single Featured hero flag on Post (only one row true at a time; enforced in
--    the service).
ALTER TABLE "Post" ADD COLUMN "featured" BOOLEAN NOT NULL DEFAULT false;

-- 6) Drop the old free-text tags column (data preserved as Tag rows above).
ALTER TABLE "Post" DROP COLUMN "tags";
