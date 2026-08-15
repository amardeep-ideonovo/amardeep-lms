import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "@lms/ui/tokens.css";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import Topbar from "@/components/Topbar";
import AuthGuard from "@/components/AuthGuard";
import { AdminAuthProvider } from "@/components/AdminAuthProvider";
import { DialogProvider } from "@/components/DialogProvider";
import { ToastProvider } from "@/components/ToastProvider";
import { QueryProvider } from "@/lib/query";
import { withBase } from "@/lib/base-path";

// Spark UI type — Plus Jakarta Sans everywhere (display + body; owner's call
// over the pack's Space Grotesk), exposed as a CSS var consumed by
// globals.css (--font-sans AND --font-display).
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
  display: "swap",
});

// Per-instance brand for the admin browser-tab title, resolved server-side from
// the same public GET /app/config the chrome uses (via useAppBrand). Reached over
// the internal compose network (API_URL_INTERNAL) so ONE prebuilt admin image
// brands each instance's tab. Never throws; a LEGACY stored "LMS" reads as unset
// -> neutral "Admin" (the product default is now "Spotlight Academy", shown as-is).
async function fetchBrandTitle(): Promise<string | null> {
  const base =
    process.env.API_URL_INTERNAL ||
    process.env.RUNTIME_API_URL ||
    "http://localhost:3000";
  try {
    const res = await fetch(`${base}/app/config`, { next: { revalidate: 30 } });
    if (!res.ok) return null;
    const cfg = (await res.json()) as { title?: unknown };
    const title = typeof cfg.title === "string" ? cfg.title.trim() : "";
    return title && title !== "LMS" ? title : null;
  } catch {
    return null;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const brand = await fetchBrandTitle();
  return {
    title: brand ? `${brand} · Admin` : "Admin",
    description: brand ? `${brand} admin panel` : "Admin panel",
  };
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={jakarta.variable}>
      <body>
        {/* Per-instance runtime config — loads before the app bundle so
            window.__ENV__ (API/web origins) is set when lib/api.ts runs.
            withBase() honors NEXT_PUBLIC_ADMIN_BASE_PATH when the admin is
            served under a path prefix (e.g. /admin). */}
        <script src={withBase("/env.js")} />
        {/* ToastProvider is outermost: AdminAuthProvider rolls back optimistic
            writes (the sidebar order) and needs the toast channel to say so.
            The stack is position:fixed at z-index 90 — above the dialog layer
            (max 60) — so nesting order doesn't change what paints on top. */}
        <QueryProvider>
          <ToastProvider>
            <AdminAuthProvider>
              <DialogProvider>
                <div className="app-shell">
                  <Sidebar />
                  <main className="app-main">
                    <Topbar />
                    {/* .app-content is the scrolling light panel (the signature
                      22px top-left radius against the ink chrome holds while
                      scrolling because the radius lives on the scroll
                      container). .app-content-inner caps the line length on
                      wide screens. */}
                    <div className="app-content">
                      <div className="app-content-inner">
                        <AuthGuard>{children}</AuthGuard>
                      </div>
                    </div>
                  </main>
                </div>
              </DialogProvider>
            </AdminAuthProvider>
          </ToastProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
