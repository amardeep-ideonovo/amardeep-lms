// Shared helpers for the Projects (internal team chat + task lists) admin pages.
// Admin ids are stored as plain strings on chat rows (no FK), so the UI resolves
// them to display names via the admin roster. That roster (GET /admin/admins) is
// SuperAdminGuard-protected, so it 403s for permission-scoped admins — every
// caller must tolerate an empty roster and fall back to a short id.
import type { AdminDTO } from "@lms/types";
import { api } from "./api";

export type AdminLite = { id: string; name: string; email: string };

// Load the admin roster for name resolution. Returns [] (never throws) when the
// caller lacks super-admin rights, so the chat still renders with id fallbacks.
export async function loadAdminRoster(): Promise<AdminLite[]> {
  try {
    const rows = await api.listAdmins();
    return rows.map((a: AdminDTO) => ({
      id: a.id,
      name: (a.name && a.name.trim()) || a.email,
      email: a.email,
    }));
  } catch {
    return [];
  }
}

// Map from admin id -> display name, with a short-id fallback for unknown ids
// (e.g. an admin removed after posting, or the roster being unavailable).
export type NameResolver = (adminId: string | null | undefined) => string;

export function makeNameResolver(roster: AdminLite[]): NameResolver {
  const byId = new Map(roster.map((a) => [a.id, a.name]));
  return (adminId) => {
    if (!adminId) return "Someone";
    return byId.get(adminId) ?? shortId(adminId);
  };
}

// Compact, stable label for an unknown admin id ("Admin a1b2c3").
export function shortId(id: string): string {
  return `Admin ${id.slice(0, 6)}`;
}

// Initials for a display name (avatar fallback). "Jane Doe" -> "JD".
export function initials(name: string): string {
  const parts = name.split(/[\s@._-]+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "?";
  const b = parts[1]?.[0] ?? "";
  return (a + b).toUpperCase();
}

// Parse "@token" handles out of a composed message body and resolve them to
// admin ids using the roster (case-insensitive match on name OR email-local).
// Returns the unique set of resolved ids; unmatched @text is left as-is in the
// body and simply contributes no id (so the message still sends with @text).
export function resolveMentions(body: string, roster: AdminLite[]): string[] {
  if (roster.length === 0) return [];
  const handles = body.match(/@([\w.\-]+)/g) ?? [];
  if (handles.length === 0) return [];
  const ids = new Set<string>();
  for (const raw of handles) {
    const token = raw.slice(1).toLowerCase();
    for (const a of roster) {
      const nameKey = a.name.toLowerCase().replace(/\s+/g, "");
      const emailLocal = a.email.split("@")[0].toLowerCase();
      if (nameKey === token || emailLocal === token || a.id === raw.slice(1)) {
        ids.add(a.id);
        break;
      }
    }
  }
  return Array.from(ids);
}

// A short, friendly relative/absolute timestamp for message rows.
export function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const sameDay = d.toDateString() === new Date().toDateString();
  if (sameDay)
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
