import { NextResponse } from "next/server";

// Per-instance runtime config, served as JavaScript and loaded BEFORE the app
// bundle (see the <script> in app/layout.tsx). Route handlers are always
// dynamic, so these values are read at REQUEST time from the container's
// environment — letting ONE prebuilt image serve any provisioned instance
// without a rebuild. `window.__ENV__` is what lib/api.ts reads in the browser.
export const dynamic = "force-dynamic";

export function GET() {
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

  const body = `window.__ENV__=${JSON.stringify({ apiUrl, webUrl })};`;
  return new NextResponse(body, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
