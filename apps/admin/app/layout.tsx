import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import AuthGuard from "@/components/AuthGuard";

export const metadata: Metadata = {
  title: "LMS Admin",
  description: "Membership LMS admin panel",
};

// Admin may be served under a path prefix (e.g. /admin); the runtime-config
// script must be requested under that same prefix.
const basePath = process.env.NEXT_PUBLIC_ADMIN_BASE_PATH || "";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {/* Per-instance runtime config — loads before the app bundle so
            window.__ENV__ (API/web origins) is set when lib/api.ts runs. */}
        <script src={`${basePath}/env.js`} />
        <div className="app-shell">
          <Sidebar />
          <main className="app-main">
            <AuthGuard>{children}</AuthGuard>
          </main>
        </div>
      </body>
    </html>
  );
}
