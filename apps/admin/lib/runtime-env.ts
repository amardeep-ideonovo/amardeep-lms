// Per-instance origins resolved at RUNTIME from `window.__ENV__` (injected by the
// /__env.js route before hydration), with build-time and dev fallbacks. This is
// what lets ONE prebuilt admin image serve any provisioned LMS instance: the
// API/web origins come from the container's env at request time, not from values
// baked into the JS bundle at build.
type RuntimeEnv = { apiUrl?: string; webUrl?: string };

function read(): RuntimeEnv {
  if (typeof window === "undefined") return {};
  return (window as unknown as { __ENV__?: RuntimeEnv }).__ENV__ ?? {};
}

export function apiUrl(): string {
  return (
    read().apiUrl ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

export function webUrl(): string {
  return (
    read().webUrl ||
    process.env.NEXT_PUBLIC_WEB_URL ||
    "http://localhost:3002"
  ).replace(/\/$/, "");
}
