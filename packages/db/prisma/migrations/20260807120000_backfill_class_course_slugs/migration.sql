-- Backfill URL slugs for classes (Level) and courses (Course) that pre-date the
-- auto-slug feature and still have slug = NULL. Derives a readable slug from the
-- name/title with the SAME base + "-2"/"-3" uniqueness rule the app uses, so
-- every existing class/course gets a readable /classes/<slug> and
-- /courses/<slug> URL without an admin re-save.
--
-- The WHILE loop skips any slug already in use (existing rows OR ones assigned
-- earlier in this same run — mid-transaction UPDATEs are visible to the next
-- EXISTS), so it can never violate the unique index. Idempotent: only NULL-slug
-- rows are touched, so a re-run or a fresh instance is a no-op.
DO $$
DECLARE r RECORD; base TEXT; cand TEXT; n INT;
BEGIN
  FOR r IN SELECT id, name FROM "Level" WHERE slug IS NULL ORDER BY "createdAt" LOOP
    base := trim(both '-' FROM regexp_replace(lower(r.name), '[^a-z0-9]+', '-', 'g'));
    IF base = '' THEN CONTINUE; END IF;
    n := 1; cand := base;
    WHILE EXISTS (SELECT 1 FROM "Level" WHERE slug = cand) LOOP
      n := n + 1; cand := base || '-' || n;
    END LOOP;
    UPDATE "Level" SET slug = cand WHERE id = r.id;
  END LOOP;

  FOR r IN SELECT id, title FROM "Course" WHERE slug IS NULL ORDER BY "createdAt" LOOP
    base := trim(both '-' FROM regexp_replace(lower(r.title), '[^a-z0-9]+', '-', 'g'));
    IF base = '' THEN CONTINUE; END IF;
    n := 1; cand := base;
    WHILE EXISTS (SELECT 1 FROM "Course" WHERE slug = cand) LOOP
      n := n + 1; cand := base || '-' || n;
    END LOOP;
    UPDATE "Course" SET slug = cand WHERE id = r.id;
  END LOOP;
END $$;
