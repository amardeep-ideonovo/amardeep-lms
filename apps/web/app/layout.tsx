import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "LMS — Member",
  description: "Membership LMS member portal",
};

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
        <script src="/env.js" />
        <Nav />
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
