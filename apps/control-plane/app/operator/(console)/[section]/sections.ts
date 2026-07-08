// Fixed section set for this dashboard's sidebar. Plain module (NOT
// "use client") so the server wrapper's generateStaticParams can read it —
// exports of client modules are opaque references on the server.
export const SECTIONS = [
  "provisioning",
  "updates",
  "backups",
  "plans",
  "licenses",
  "clients",
  "billing",
  "hosts",
  "alerts",
  "audit",
  "settings",
] as const;
export type Section = (typeof SECTIONS)[number];
