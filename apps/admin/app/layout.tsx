import type { Metadata } from "next";
import { Montserrat, Playfair_Display } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import Topbar from "@/components/Topbar";
import AuthGuard from "@/components/AuthGuard";
import { AdminAuthProvider } from "@/components/AdminAuthProvider";
import { DialogProvider } from "@/components/DialogProvider";

// UI/body sans + display serif — exposed as CSS vars consumed by globals.css.
const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-montserrat",
  display: "swap",
});
const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-playfair",
  display: "swap",
});

export const metadata: Metadata = {
  title: "LMS Admin",
  description: "Membership LMS admin panel",
};

// Resolve the saved theme preference before first paint to avoid a flash.
// Defaults to "dark" (the brand's home base). ThemeToggle keeps localStorage +
// <html data-theme> in sync; "system" remains a selectable preference.
const themeScript = `(function(){try{var p=localStorage.getItem('lms.admin.theme')||'dark';var d=p==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):p;document.documentElement.setAttribute('data-theme',d);}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${montserrat.variable} ${playfair.variable}`}
      suppressHydrationWarning
    >
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
