"use client";

import { useEffect, useLayoutEffect, useState } from "react";

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * True once `url` has finished loading — used to fade a CSS background-image
 * layer in instead of letting the photo pop over its placeholder.
 *
 * The check runs in a LAYOUT effect so an already-cached image flips to
 * visible BEFORE the first paint: warm visits show the photo instantly with
 * no fade flash; only a genuinely-loading image animates in.
 */
export function useImageLoaded(url?: string | null): boolean {
  const [loaded, setLoaded] = useState(false);
  useIsomorphicLayoutEffect(() => {
    if (!url) return;
    const img = new Image();
    img.src = url;
    if (img.complete) {
      setLoaded(true); // cached — visible pre-paint, no transition
      return;
    }
    setLoaded(false);
    let alive = true;
    img.onload = () => {
      if (alive) setLoaded(true);
    };
    return () => {
      alive = false;
    };
  }, [url]);
  return loaded;
}
