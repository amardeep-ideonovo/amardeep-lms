-- Audio lessons. A lesson's media is mutually exclusive: `audioUrl` set means an
-- audio lesson, otherwise `videoUrl` (Vimeo / YouTube / direct file) drives a
-- video lesson, and both null is a text-only lesson. Nullable + additive, so
-- existing rows and older app builds (which never read this column) are
-- unaffected.
ALTER TABLE "Lesson" ADD COLUMN "audioUrl" TEXT;
