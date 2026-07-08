// Fixed section set for this dashboard's sidebar. Plain module (NOT
// "use client") so the server wrapper's generateStaticParams can read it —
// exports of client modules are opaque references on the server.
export const SECTIONS = ["instance", "backups", "mobile", "billing", "support"] as const;
export type Section = (typeof SECTIONS)[number];
