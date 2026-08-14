"use client";

import type { LessonDTO } from "@lms/types";
import MediaPicker from "./MediaPicker";
import {
  detectVideoSource,
  validateVideoUrl,
  type LessonMediaType,
  type VideoSource,
} from "@/lib/lessonMedia";

// Controlled state for a lesson's media, shared by the Add and Edit forms.
// `videoUrl` and `audioUrl` are kept independently so switching Video<->Audio
// (or between video sources) preserves what the admin already typed until save.
export type LessonMediaState = {
  mediaType: LessonMediaType;
  videoSource: VideoSource;
  videoUrl: string;
  audioUrl: string;
};

export function emptyLessonMedia(): LessonMediaState {
  return {
    mediaType: "video",
    videoSource: "vimeo",
    videoUrl: "",
    audioUrl: "",
  };
}

// Seed the form from a saved lesson: audio wins if present, otherwise the video
// source is derived from the stored URL so the dropdown opens on the right one.
export function lessonMediaFromDTO(lesson: LessonDTO): LessonMediaState {
  if (lesson.audioUrl) {
    return {
      mediaType: "audio",
      videoSource: "vimeo",
      videoUrl: "",
      audioUrl: lesson.audioUrl,
    };
  }
  const videoUrl = lesson.videoUrl ?? "";
  return {
    mediaType: "video",
    videoSource: detectVideoSource(videoUrl),
    videoUrl,
    audioUrl: "",
  };
}

// Build the API payload's media fields. BOTH are always sent (the active one +
// "" for the other) so the server clears the counterpart on a type switch —
// see LmsService.resolveMedia. Empty video AND audio = a text-only lesson.
export function lessonMediaPayload(s: LessonMediaState): {
  videoUrl: string;
  audioUrl: string;
} {
  return s.mediaType === "audio"
    ? { videoUrl: "", audioUrl: s.audioUrl.trim() }
    : { videoUrl: s.videoUrl.trim(), audioUrl: "" };
}

// Submit-time guard. Audio is an upload (always a valid URL); for video, a
// non-empty Vimeo/YouTube URL must actually parse. Returns an error or null.
export function validateLessonMedia(s: LessonMediaState): string | null {
  if (s.mediaType === "audio") return null;
  return validateVideoUrl(s.videoSource, s.videoUrl);
}

const radioLabel: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  cursor: "pointer",
};

export default function LessonMediaFields({
  state,
  onChange,
  name,
  disabled,
}: {
  state: LessonMediaState;
  onChange: (next: LessonMediaState) => void;
  // Groups the two radios; must be unique per mounted form (Add vs each Edit).
  name: string;
  disabled?: boolean;
}) {
  const set = (patch: Partial<LessonMediaState>) =>
    onChange({ ...state, ...patch });
  const warning =
    state.mediaType === "video"
      ? validateVideoUrl(state.videoSource, state.videoUrl)
      : null;

  return (
    <div className="field">
      <label>Lesson media</label>
      <div className="row-actions" style={{ marginBottom: 10, gap: 18 }}>
        <label style={radioLabel}>
          <input
            type="radio"
            name={name}
            checked={state.mediaType === "video"}
            disabled={disabled}
            onChange={() => set({ mediaType: "video" })}
          />
          Video
        </label>
        <label style={radioLabel}>
          <input
            type="radio"
            name={name}
            checked={state.mediaType === "audio"}
            disabled={disabled}
            onChange={() => set({ mediaType: "audio" })}
          />
          Audio
        </label>
      </div>

      {state.mediaType === "video" ? (
        <>
          <div className="field" style={{ maxWidth: 220 }}>
            <label>Video source</label>
            <select
              value={state.videoSource}
              disabled={disabled}
              onChange={(e) => {
                const next = e.target.value as VideoSource;
                // Drop a retained URL that the new source would immediately
                // reject (e.g. a Vimeo link left over when switching to
                // YouTube), so the field starts clean instead of flashing red.
                const keep = !validateVideoUrl(next, state.videoUrl);
                set({
                  videoSource: next,
                  videoUrl: keep ? state.videoUrl : "",
                });
              }}
            >
              <option value="vimeo">Vimeo</option>
              <option value="youtube">YouTube</option>
              {/* Uploading videos isn't offered — host on Vimeo/YouTube. This
                  option only appears for a legacy lesson that already stores a
                  direct video URL, so it can still be edited or migrated. */}
              {state.videoSource === "file" && (
                <option value="file">Video file (existing)</option>
              )}
            </select>
          </div>
          <input
            type="text"
            value={state.videoUrl}
            disabled={disabled}
            onChange={(e) => set({ videoUrl: e.target.value })}
            placeholder={
              state.videoSource === "youtube"
                ? "https://www.youtube.com/watch?v=…"
                : state.videoSource === "file"
                  ? "Direct video URL"
                  : "https://vimeo.com/123456789"
            }
          />
          {state.videoSource === "file" ? (
            <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              Uploading video files isn’t supported — host on Vimeo or YouTube
              and paste the link. This existing link still plays.
            </p>
          ) : null}
          {warning ? (
            <p className="error" style={{ marginTop: 6 }}>
              {warning}
            </p>
          ) : null}
        </>
      ) : (
        <div className="field">
          <label>Select audio</label>
          <MediaPicker
            kind="audio"
            value={state.audioUrl}
            disabled={disabled}
            onChange={(url) => set({ audioUrl: url })}
          />
        </div>
      )}
    </div>
  );
}
