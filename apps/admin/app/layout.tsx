import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import Topbar from "@/components/Topbar";
import AuthGuard from "@/components/AuthGuard";
import { AdminAuthProvider } from "@/components/AdminAuthProvider";
import { DialogProvider } from "@/components/DialogProvider";

export const metadata: Metadata = {
  title: "LMS Admin",
  description: "Membership LMS admin panel",
};

// Resolve the saved theme preference before first paint to avoid a flash.
// Defaults to "system". ThemeToggle keeps localStorage + <html data-theme> in sync.
const themeScript = `(function(){try{var p=localStorage.getItem('lms.admin.theme')||'system';var d=p==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):p;document.documentElement.setAttribute('data-theme',d);}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <AdminAuthProvider>
          <DialogProvider>
            <div className="app-shell">
              <Sidebar />
              <main className="app-main">
                <Topbar />
                <div className="app-content">
                  <AuthGuard>{children}</AuthGuard>
                </div>
              </main>
            </div>
          </DialogProvider>
        </AdminAuthProvider>
      </body>
    </html>
  );
}
