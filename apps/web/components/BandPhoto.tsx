"use client";

import { useImageLoaded } from "@/lib/use-image-loaded";

// The hero band's cover photo as a fading layer: the band paints its navy base
// immediately and the photo glides in when decoded, instead of hard-flipping
// the whole header. Rendered inside `.ik-band--photo` (the scrim ::before and
// content sit above it — see the z-index layering in globals.css).
export default function BandPhoto({ url }: { url: string }) {
  const loaded = useImageLoaded(url);
  return (
    <span
      className={loaded ? "ik-band-photo-img is-on" : "ik-band-photo-img"}
      style={{ backgroundImage: `url(${url})` }}
      aria-hidden="true"
    />
  );
}
