import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import Topbar from "@/components/Topbar";
import AuthGuard from "@/components/AuthGuard";
import { AdminAuthProvider } from "@/components/AdminAuthProvider";
import { DialogProvider } from "@/components/DialogProvider";
import { withBase } from "@/lib/base-path";

// Ink Hero UI type — Plus Jakarta Sans everywhere (display + body), exposed as
// a CSS var consumed by globals.css (--font-sans AND --font-display).
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
  display: "swap",
});

export const metadata: Metadata = {
  title: "LMS Admin",
  description: "Membership LMS admin panel",
};

// Resolve the saved theme preference before first paint to avoid a flash.
// Ink Hero has a SINGLE appearance — :root and [data-theme="light"] carry the
// same token values — so whatever preference is stored renders identically.
// The plumbing stays so stored preferences keep resolving without errors.
const themeScript = `(function(){try{var p=localStorage.getItem('lms.admin.theme')||'light';var d=p==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):p;document.documentElement.setAttribute('data-theme',d);}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={jakarta.variable}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        {/* Per-instance runtime config — loads before the app bundle so
            window.__ENV__ (API/web origins) is set when lib/api.ts runs.
            withBase() honors NEXT_PUBLIC_ADMIN_BASE_PATH when the admin is
            served under a path prefix (e.g. /admin). */}
        <script src={withBase("/env.js")} />
        <AdminAuthProvider>
          <DialogProvider>
            <div className="app-shell">
              <Sidebar />
              <main className="app-main">
                <Topbar />
                {/* .app-content is the scrolling light panel (the signature
                    22px top-left radius against the ink chrome holds while
                    scrolling because the radius lives on the scroll container).
                    .app-content-inner caps the line length on wide screens. */}
                <div className="app-content">
                  <div className="app-content-inner">
                    <AuthGuard>{children}</AuthGuard>
                  </div>
                </div>
              </main>
            </div>
          </DialogProvider>
        </AdminAuthProvider>
      </body>
    </html>
  );
}
