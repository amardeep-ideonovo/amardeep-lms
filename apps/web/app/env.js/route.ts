import { NextResponse } from "next/server";
import { runtimeEnv } from "@/lib/runtime-env";

// Per-instance runtime config, served as JavaScript. The app now sets
// `window.__ENV__` via an inline, synchronous <script> in app/layout.tsx
// (loaded before hydration, no race); this route is kept so any external
// reference to /env.js still resolves. Route handlers are always dynamic, so
// the values are read at REQUEST time from the container's environment.
export const dynamic = "force-dynamic";

export function GET() {
  const body = `window.__ENV__=${JSON.stringify(runtimeEnv())};`;
  return new NextResponse(body, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
