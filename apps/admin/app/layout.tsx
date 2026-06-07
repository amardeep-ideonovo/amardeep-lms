import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import AuthGuard from "@/components/AuthGuard";
import { AdminAuthProvider } from "@/components/AdminAuthProvider";

export const metadata: Metadata = {
  title: "LMS Admin",
  description: "Membership LMS admin panel",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AdminAuthProvider>
          <div className="app-shell">
            <Sidebar />
            <main className="app-main">
              <AuthGuard>{children}</AuthGuard>
            </main>
          </div>
        </AdminAuthProvider>
      </body>
    </html>
  );
}
