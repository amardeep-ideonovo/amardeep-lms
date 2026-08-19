"use client";

import { useImageLoaded } from "@/lib/use-image-loaded";

// The hero band's cover photo as a fading layer: the band paints its navy base
// immediately and the photo glides in when decoded, instead of hard-flipping
// the whole header. The ink scrim is baked into the SAME layer (globals.css
// composes it over var(--band-img)), so it can never paint over the panels
// that overlap the band.
export default function BandPhoto({ url }: { url: string }) {
  const loaded = useImageLoaded(url);
  return (
    <span
      className={loaded ? "ik-band-photo-img is-on" : "ik-band-photo-img"}
      style={{ "--band-img": `url(${url})` } as React.CSSProperties}
      aria-hidden="true"
    />
  );
}
