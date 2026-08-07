import { NextResponse, type NextRequest } from "next/server";

// Server Components can't read the request pathname (there is no usePathname on
// the server). We copy it into an `x-pathname` request header so the root
// layout can resolve the site header for THIS route at SSR — matching the
// client's path-aware resolve, so a header hidden on this section/page never
// paints on first load (no flash-then-hide on refresh). See app/layout.tsx.
export function middleware(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set("x-pathname", req.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Run on real page routes only — skip Next internals and any path with a file
  // extension (env.js, favicon.ico, images, etc.). Middleware here only sets a
  // header, so it stays cheap.
  matcher: ["/((?!_next/|.*\\..*).*)"],
};
