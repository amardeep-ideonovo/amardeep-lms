// Shared helpers for the Projects (internal team chat + task lists) admin pages.
// Admin ids are stored as plain strings on chat rows (no FK), so the UI resolves
// them to display names via the admin roster. That roster (GET /admin/admins) is
// SuperAdminGuard-protected, so it 403s for permission-scoped admins — every
// caller must tolerate an empty roster and fall back to a short id.
import type {
  AdminDTO,
  ChatMessageDTO,
  ChatReactionGroupDTO,
} from "@lms/types";
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

// ---------------------------------------------------------------------------
// Local echo: a message the admin has sent but the server hasn't answered for.
// ---------------------------------------------------------------------------
// The socket carries other admins' messages; our own send goes over REST, so
// without an echo the admin's own message is the slowest one in the room. A
// pending message is a real ChatMessageDTO with a client id and a `pending`
// flag, held in the SAME list the pane renders from, so nothing downstream
// needs to know it isn't real yet.
export type PendingState = "sending" | "failed";
export type LocalChatMessage = ChatMessageDTO & { pending?: PendingState };

// Pending messages sort after everything the server has numbered. Their `seq`
// is never fed back into the catch-up cursor (see chatHighWaterSeq).
export const PENDING_SEQ = Number.MAX_SAFE_INTEGER;
const TEMP_PREFIX = "temp:";

let tempCounter = 0;

export function isPendingMessage(m: LocalChatMessage): boolean {
  return m.pending !== undefined;
}

// Build the echo shown while the POST is in flight. `createdAt` is a local
// clock reading purely so the row can render a time; the server's own
// timestamp + seq replace the whole row when the response lands.
export function makePendingMessage(args: {
  channelId: string;
  authorAdminId: string;
  body: string;
  parentMessageId?: string;
}): LocalChatMessage {
  tempCounter += 1;
  return {
    id: `${TEMP_PREFIX}${tempCounter}`,
    seq: PENDING_SEQ,
    channelId: args.channelId,
    authorAdminId: args.authorAdminId,
    body: args.body,
    parentMessageId: args.parentMessageId ?? null,
    createdAt: new Date().toISOString(),
    editedAt: null,
    deletedAt: null,
    reactions: [],
    replyCount: 0,
    pending: "sending",
  };
}

// Server order. `seq` is the API's own monotonic counter, assigned when the
// message is persisted, so sorting by it IS sorting by server arrival —
// unlike createdAt it can't tie or go backwards across clock skew. Pending
// echoes have no server order yet and sit at the end, oldest first.
export function sortChatMessages<T extends LocalChatMessage>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    if (a.seq !== b.seq) return a.seq - b.seq;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

// The catch-up cursor must ignore pending echoes — their placeholder seq would
// otherwise jump the high-water mark past every real message.
export function chatHighWaterSeq(list: LocalChatMessage[]): number {
  return list.reduce(
    (max, m) => (isPendingMessage(m) ? max : Math.max(max, m.seq)),
    0,
  );
}

// Drop the echo a real message supersedes. The REST response is matched by the
// temp id the sender remembers; this is the OTHER path — the gateway emits new
// messages to the whole channel room, sender included, so our own message can
// arrive over the socket BEFORE the POST resolves. Matching on author + parent
// + exact body clears the echo instead of showing the text twice.
//
// A FAILED echo is matched too: a POST can fail on the client (timeout, dropped
// connection) after the server persisted the message, and when the real thing
// turns up the failed copy is a duplicate, not a lost message — leaving it
// there would invite a Retry that posts the text twice. Oldest match first, so
// a stale failure is cleared before an echo that is still in flight.
export function reconcilePending<T extends LocalChatMessage>(
  list: T[],
  incoming: ChatMessageDTO,
  myAdminId: string,
): T[] {
  if (!myAdminId || incoming.authorAdminId !== myAdminId) return list;
  const parent = incoming.parentMessageId ?? null;
  const match = list.find(
    (m) =>
      isPendingMessage(m) &&
      m.body === incoming.body &&
      (m.parentMessageId ?? null) === parent &&
      m.channelId === incoming.channelId,
  );
  return match ? list.filter((m) => m.id !== match.id) : list;
}

// Toggle MY reaction on a message's grouped chips, the way the server does:
// add the emoji group if it's new, drop it when the last admin leaves.
export function toggleReactionGroups(
  groups: ChatReactionGroupDTO[],
  emoji: string,
  myAdminId: string,
): ChatReactionGroupDTO[] {
  const group = groups.find((g) => g.emoji === emoji);
  if (!group) return [...groups, { emoji, adminIds: [myAdminId] }];
  const mine = group.adminIds.includes(myAdminId);
  const adminIds = mine
    ? group.adminIds.filter((id) => id !== myAdminId)
    : [...group.adminIds, myAdminId];
  if (adminIds.length === 0) return groups.filter((g) => g.emoji !== emoji);
  return groups.map((g) => (g.emoji === emoji ? { ...g, adminIds } : g));
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
