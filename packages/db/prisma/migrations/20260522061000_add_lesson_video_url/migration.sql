-- Add a direct video URL to lessons. Plays without Mux signing (sample/dev
-- video, or any direct MP4/HLS URL); the Mux signed-playback path is unchanged.
ALTER TABLE "Lesson" ADD COLUMN "videoUrl" TEXT;
