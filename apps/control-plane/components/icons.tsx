// Inline SVG icon set — paths copied verbatim from the Ink Hero design frames
// (24px grid, 1.7px stroke, round caps/joins). No icon library dependency.

import type { ReactNode } from "react";

export type IconName =
  | "package"
  | "arrow-up"
  | "download"
  | "database"
  | "shield"
  | "users"
  | "credit-card"
  | "server"
  | "alert-triangle"
  | "file-text"
  | "settings"
  | "search"
  | "bell"
  | "grid"
  | "smartphone"
  | "lifebuoy"
  | "check"
  | "external-link"
  | "video"
  | "brush"
  | "award"
  | "tag"
  | "play";

const PATHS: Record<IconName, ReactNode> = {
  package: (
    <>
      <path
        d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m3.3 7 8.7 5 8.7-5M12 22V12"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  "arrow-up": (
    <path
      d="M12 19V5M5 12l7-7 7 7"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  download: (
    <path
      d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  database: (
    <>
      <ellipse cx="12" cy="5" rx="9" ry="3" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"
        stroke="currentColor"
        strokeWidth="1.7"
      />
    </>
  ),
  shield: (
    <path
      d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  users: (
    <path
      d="M16 19v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM22 19v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  "credit-card": (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M2 10h20" stroke="currentColor" strokeWidth="1.7" />
    </>
  ),
  server: (
    <>
      <rect x="2" y="2" width="20" height="8" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <rect x="2" y="14" width="20" height="8" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M6 6h.01M6 18h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </>
  ),
  "alert-triangle": (
    <path
      d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  "file-text": (
    <>
      <path
        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M14 2v6h6M8 13h8M8 17h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 14H4.5a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 6 8.6a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 10 4.6h.09A1.65 1.65 0 0 0 11.27 3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9.27"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  bell: (
    <path
      d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
    </>
  ),
  smartphone: (
    <>
      <rect x="7" y="2" width="10" height="20" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M10.5 18.5h3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </>
  ),
  lifebuoy: (
    <>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="3.5" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="m5.7 5.7 3.8 3.8M14.5 14.5l3.8 3.8M18.3 5.7l-3.8 3.8M9.5 14.5l-3.8 3.8"
        stroke="currentColor"
        strokeWidth="1.7"
      />
    </>
  ),
  check: (
    <path
      d="M20 6 9 17l-5-5"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  "external-link": (
    <path
      d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  video: (
    <>
      <rect x="2" y="6" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="m16 10 6-3v10l-6-3z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </>
  ),
  brush: (
    <path
      d="M9.06 11.9 20.5 1.5c.83-.76 2.12-.72 2.9.1.78.82.74 2.12-.1 2.9L12.9 15.14M9.06 11.9a4.5 4.5 0 0 0-6.1 4.2c0 2.7-1.1 3.9-2.5 4.9 2.1 1.4 4.7 1.5 7.1.6a4.5 4.5 0 0 0 1.5-9.7Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  award: (
    <>
      <circle cx="12" cy="9" r="6" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M9 14.5 8 22l4-2.5L16 22l-1-7.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  tag: (
    <>
      <path
        d="M20.59 13.41 11.42 4.24A2 2 0 0 0 10 3.66H5a2 2 0 0 0-2 2v5a2 2 0 0 0 .59 1.42l9.17 9.17a2 2 0 0 0 2.83 0l5-5a2 2 0 0 0 0-2.84Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M7.6 8.26h.01" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </>
  ),
  play: <path d="m8 5 12 7-12 7z" fill="currentColor" />,
};

export function Icon({ name, size = 17 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

/** Spotlight logo glyph — teal spotlight beam + ellipse pool (from the frames). */
export function LogoGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 2.2 11.6 6 7.8 12.6 1.2 8.8Z" fill="#3cc4b2" />
      <ellipse cx="14.8" cy="18.6" rx="6.8" ry="2.9" fill="rgba(60,196,178,.32)" />
    </svg>
  );
}
