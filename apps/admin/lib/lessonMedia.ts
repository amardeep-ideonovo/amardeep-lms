// Lesson media helpers shared by the Add and Edit lesson forms.
//
// A lesson's media is one of: a Video (Vimeo link, YouTube link, or a direct
// file URL/upload) or an Audio file. The type + video source are DERIVED from
// the stored URL — there is no separate column — so these parsers are the one
// place that classifies a URL, keeping the admin dropdown and the web/mobile
// players in agreement.

export type LessonMediaType = "video" | "audio";
export type VideoSource = "vimeo" | "youtube" | "file";

// Vimeo numeric id from any vimeo.com path shape — vimeo.com/<id>, /video/<id>,
// player.vimeo.com/video/<id>, or /channels|groups|showcase/<id> (kept in step
// with the web + mobile `vimeoEmbed` parsers).
export function parseVimeoId(url: string): string | null {
  return url.match(/vimeo\.com\/(?:[^/?#]+\/)*(\d+)/)?.[1] ?? null;
}

// YouTube 11-char video id from watch / youtu.be / shorts / embed / v links
// (with or without the -nocookie / m. host). Kept byte-in-step with the web +
// mobile `youtubeId` parsers.
export function parseYouTubeId(url: string): string | null {
  return (
    url.match(
      /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|v\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/,
    )?.[1] ?? null
  );
}

// Classify a stored videoUrl so the Edit form opens on the right source. Vimeo
// and YouTube are recognized by their parsers; anything else (a direct MP4/HLS
// URL or a media-library upload) is a "file". Empty defaults to Vimeo — the
// most common source — for a fresh form.
export function detectVideoSource(url: string): VideoSource {
  if (!url.trim()) return "vimeo";
  // Vimeo-first, matching the web + mobile player if-chains, so any single URL
  // resolves to the same source in the admin and in the players.
  if (parseVimeoId(url)) return "vimeo";
  if (parseYouTubeId(url)) return "youtube";
  return "file";
}

// Submit-time guard: for a Vimeo/YouTube source, a non-empty URL that doesn't
// parse would save a dead player, so block it with a clear message. A "file"
// source accepts any URL (upload or direct link). Returns an error string, or
// null when the value is acceptable (including empty — a text-only lesson).
export function validateVideoUrl(
  source: VideoSource,
  url: string,
): string | null {
  const v = url.trim();
  if (!v) return null;
  if (source === "vimeo" && !parseVimeoId(v)) {
    return "That doesn't look like a Vimeo link. Paste a vimeo.com URL, or switch the source.";
  }
  if (source === "youtube" && !parseYouTubeId(v)) {
    return "That doesn't look like a YouTube link. Paste a youtube.com / youtu.be URL, or switch the source.";
  }
  return null;
}
