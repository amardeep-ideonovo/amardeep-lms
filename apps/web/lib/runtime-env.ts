// Per-instance runtime origins, read from the container's environment at
// REQUEST time (the root layout is dynamic — it reads headers(), which opts
// every route out of static prerender), so ONE prebuilt image serves any
// provisioned instance without a rebuild.
//
// Consumed by BOTH:
//   • the inline <script> in app/layout.tsx that sets `window.__ENV__`
//     SYNCHRONOUSLY, before hydration — so the client's apiBase() never falls
//     back to localhost mid-render (a deferred /env.js raced React and, when
//     the ownership effect won, made owned-gated views fetch the wrong host,
//     fail, and stick on the guest view), and
//   • app/env.js/route.ts (kept so any external reference to /env.js still
//     resolves).
export function runtimeEnv(): { apiUrl: string; webUrl: string } {
  const apiUrl = (
    process.env.RUNTIME_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
  const webUrl = (
    process.env.RUNTIME_WEB_URL ||
    process.env.NEXT_PUBLIC_WEB_URL ||
    "http://localhost:3002"
  ).replace(/\/$/, "");
  return { apiUrl, webUrl };
}
