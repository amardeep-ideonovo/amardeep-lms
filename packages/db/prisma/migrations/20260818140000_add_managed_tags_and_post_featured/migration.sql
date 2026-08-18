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

-- 3) Fold existing free-text Post.tags into managed Tag rows.
--    Distinct tags are deduped by their NORMALIZED NAME (lower+trim) — NOT by the
--    URL slug — so semantically different tags that would share a slug (e.g. 'C#'
--    and 'C++', both -> 'c') stay distinct, and tags written in a non-Latin script
--    (whose slug normalizes to '') are NOT dropped. Each tag then gets a URL slug
--    from the same normalizer the app uses; an empty result falls back to 'tag',
--    and slug collisions are disambiguated with -2/-3 suffixes (mirroring the
--    runtime uniqueTagSlug), preserving both the display name and the link.
INSERT INTO "Tag" ("id", "name", "slug", "order")
SELECT gen_random_uuid()::text,
       n.name,
       CASE WHEN n.rn = 1 THEN n.base_slug ELSE n.base_slug || '-' || n.rn END,
       0
FROM (
  SELECT g.name,
         g.base_slug,
         row_number() OVER (PARTITION BY g.base_slug ORDER BY g.norm_name) AS rn
  FROM (
    SELECT lower(trim(d.name)) AS norm_name,
           min(trim(d.name)) AS name, -- trimmed, matching the runtime createTag
           COALESCE(
             NULLIF(lower(regexp_replace(regexp_replace(min(trim(d.name)), '[^a-zA-Z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g')), ''),
             'tag'
           ) AS base_slug
    FROM (SELECT DISTINCT unnest("tags") AS name FROM "Post") d
    WHERE trim(d.name) <> ''
    GROUP BY 1
  ) g
) n;

-- 4) Link each post to its (now managed) tags, matched by NORMALIZED NAME (the
--    same key step 3 deduped on) — never by slug, so a post tagged 'C++' links to
--    the 'C++' Tag, not a slug-colliding 'C#'.
INSERT INTO "_PostToTag" ("A", "B")
SELECT DISTINCT p."id", t."id"
FROM "Post" p
CROSS JOIN LATERAL unnest(p."tags") AS pt(name)
JOIN "Tag" t ON lower(trim(t."name")) = lower(trim(pt.name))
WHERE trim(pt.name) <> ''
ON CONFLICT DO NOTHING;

-- 5) Single Featured hero flag on Post (only one row true at a time; enforced in
--    the service).
ALTER TABLE "Post" ADD COLUMN "featured" BOOLEAN NOT NULL DEFAULT false;

-- 6) Drop the old free-text tags column (data preserved as Tag rows above).
ALTER TABLE "Post" DROP COLUMN "tags";
