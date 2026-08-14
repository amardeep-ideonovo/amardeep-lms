import test from "node:test";
import assert from "node:assert/strict";

import {
  vimeoEmbed,
  youtubeId,
  youtubeEmbed,
  isProviderVideoUrl,
} from "./format";

// The lesson-media URL parsers classify what player a videoUrl gets on web AND
// mobile. A mis-parse silently routes a YouTube link into the native file
// player (a dead/black box), so these shapes are pinned. The web youtubeId and
// the admin parseYouTubeId use the SAME regex — keep all three in step.

const ID = "dQw4w9WgXcQ"; // canonical 11-char id

test("youtubeId — every common link shape yields the 11-char id", () => {
  const urls = [
    `https://www.youtube.com/watch?v=${ID}`,
    `http://youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?t=42`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com/watch?list=PLxxxx&v=${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `https://www.youtube.com/v/${ID}`,
  ];
  for (const u of urls) assert.equal(youtubeId(u), ID, u);
});

test("youtubeId — non-YouTube URLs are null (so they fall through)", () => {
  assert.equal(youtubeId("https://vimeo.com/123456789"), null);
  assert.equal(youtubeId("https://cdn.example.com/lesson.mp4"), null);
  assert.equal(youtubeId("https://example.com/watch?v=short"), null); // id < 11
  assert.equal(youtubeId(""), null);
  assert.equal(youtubeId(null), null);
  assert.equal(youtubeId(undefined), null);
});

test("youtubeEmbed — privacy domain, playsinline, and start= resume", () => {
  const noResume = youtubeEmbed(`https://youtu.be/${ID}`, 0);
  assert.ok(
    noResume?.startsWith("https://www.youtube-nocookie.com/embed/" + ID),
  );
  assert.ok(noResume?.includes("playsinline=1"));
  assert.ok(!noResume?.includes("start="));

  const resumed = youtubeEmbed(`https://youtu.be/${ID}`, 125.7);
  assert.ok(resumed?.includes("start=125")); // floored, whole seconds

  assert.equal(youtubeEmbed("https://vimeo.com/1", 0), null);
});

test("vimeoEmbed parses every path shape (and rejects YouTube)", () => {
  const shapes = [
    "https://vimeo.com/123456789",
    "https://vimeo.com/video/123456789",
    "https://player.vimeo.com/video/123456789",
    "https://vimeo.com/channels/staffpicks/123456789",
    "https://vimeo.com/groups/motion/videos/123456789",
    "https://vimeo.com/showcase/999/video/123456789",
  ];
  for (const u of shapes) {
    assert.ok(
      vimeoEmbed(u)?.includes("/video/123456789"),
      `expected id 123456789 from ${u}`,
    );
  }
  // Privacy hash still extracted on the plain shape.
  assert.ok(
    vimeoEmbed("https://vimeo.com/123456789/abcdef")?.includes("h=abcdef"),
  );
  assert.equal(vimeoEmbed(`https://youtu.be/${ID}`), null);
  // A vanity slug with no path-separated numeric id yields no video id: the
  // regex needs the digits to sit as their own /segment, not embedded in a word.
  assert.equal(vimeoEmbed("https://vimeo.com/johnsmith"), null);
});

test("isProviderVideoUrl flags provider links (parseable or not), not direct files", () => {
  assert.equal(isProviderVideoUrl("https://vimeo.com/123456789"), true);
  assert.equal(
    isProviderVideoUrl(`https://www.youtube.com/watch?v=${ID}`),
    true,
  );
  assert.equal(isProviderVideoUrl("https://youtu.be/tooShort"), true); // youtube host, unparseable id
  assert.equal(isProviderVideoUrl("https://cdn.example.com/lesson.mp4"), false);
  assert.equal(isProviderVideoUrl("https://cdn.example.com/audio.mp3"), false);
  assert.equal(isProviderVideoUrl(null), false);
  assert.equal(isProviderVideoUrl(undefined), false);
});

test("a video URL is never BOTH a Vimeo and a YouTube match", () => {
  // The player if-chains assume mutual exclusivity between the two providers.
  const samples = [
    `https://www.youtube.com/watch?v=${ID}`,
    "https://vimeo.com/123456789",
    "https://vimeo.com/video/987654321",
  ];
  for (const u of samples) {
    const isVimeo = vimeoEmbed(u) != null;
    const isYt = youtubeId(u) != null;
    assert.ok(!(isVimeo && isYt), `both matched: ${u}`);
  }
});
