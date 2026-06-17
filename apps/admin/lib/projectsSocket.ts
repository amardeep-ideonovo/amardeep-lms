// Realtime client for the Projects page (Phase 3). A small singleton wrapper
// around a Socket.IO connection to the API's `/projects` namespace. The page
// keeps using REST for its own send/edit/react/thread actions; this socket only
// DELIVERS other admins' updates live (and a typing/presence nicety), replacing
// the fast append-poll.
//
// Auth: the handshake carries the stored admin bearer token (same getToken the
// REST client uses). The server verifies it and rejects non-admin sockets.
"use client";

import { io, type Socket } from "socket.io-client";
import type {
  ChatMessageDTO,
  ChatReactionGroupDTO,
} from "@lms/types";
import { API_BASE_URL, getToken } from "./api";

// ----- Event payloads (mirror the gateway's emit signatures) -----
export type ChatReactionEvent = {
  messageId: string;
  reactions: ChatReactionGroupDTO[];
};
export type ChatTypingEvent = { channelId: string; adminId: string };
export type ChatPresenceEvent = { online: string[] };
// A list's fields/items/comments changed. Channel-scoped (the gateway emits to
// the owning channel's room only), so the Lists page joins the list's channel
// to receive these; stand-alone lists (no channel) fall back to polling.
export type ChatListUpdateEvent = { channelId: string; listId: string };

// Server -> client events the page subscribes to.
type ServerEvents = {
  "chat:message": (dto: ChatMessageDTO) => void;
  "chat:message:update": (dto: ChatMessageDTO) => void;
  "chat:reaction": (evt: ChatReactionEvent) => void;
  "chat:typing": (evt: ChatTypingEvent) => void;
  "chat:presence": (evt: ChatPresenceEvent) => void;
  "chat:list:update": (evt: ChatListUpdateEvent) => void;
};

let socket: Socket | null = null;

// Lazily create (or reuse) the singleton socket. Reconnect-aware: socket.io
// retries automatically; we refresh the auth token on each (re)connect attempt
// so a token rotation doesn't wedge the connection.
export function getProjectsSocket(): Socket {
  if (socket) return socket;
  socket = io(`${API_BASE_URL}/projects`, {
    transports: ["websocket"],
    auth: (cb) => cb({ token: getToken() ?? "" }),
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
  });
  return socket;
}

export function disconnectProjectsSocket(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

// ----- Room helpers -----
export function joinChannel(channelId: string): void {
  getProjectsSocket().emit("channel:join", { channelId });
}
export function leaveChannel(channelId: string): void {
  getProjectsSocket().emit("channel:leave", { channelId });
}
export function sendTyping(channelId: string): void {
  getProjectsSocket().emit("typing", { channelId });
}

// ----- Typed subscription helpers. Each returns an unsubscribe fn. -----
function on<E extends keyof ServerEvents>(
  event: E,
  handler: ServerEvents[E],
): () => void {
  const s = getProjectsSocket();
  // socket.io's generic `.on` is loosely typed; the cast keeps our call sites
  // strongly typed against ServerEvents above.
  s.on(event as string, handler as (...args: unknown[]) => void);
  return () => {
    s.off(event as string, handler as (...args: unknown[]) => void);
  };
}

export const onChatMessage = (h: ServerEvents["chat:message"]) =>
  on("chat:message", h);
export const onChatMessageUpdate = (h: ServerEvents["chat:message:update"]) =>
  on("chat:message:update", h);
export const onChatReaction = (h: ServerEvents["chat:reaction"]) =>
  on("chat:reaction", h);
export const onChatTyping = (h: ServerEvents["chat:typing"]) =>
  on("chat:typing", h);
export const onChatPresence = (h: ServerEvents["chat:presence"]) =>
  on("chat:presence", h);
export const onChatListUpdate = (h: ServerEvents["chat:list:update"]) =>
  on("chat:list:update", h);

// Lifecycle subscriptions (connect / reconnect) for the catch-up pattern. The
// `connect` event fires on the FIRST connect AND on every successful reconnect,
// so a single handler covers "fill the gap since lastSeq" on both.
export function onConnect(handler: () => void): () => void {
  const s = getProjectsSocket();
  s.on("connect", handler);
  return () => {
    s.off("connect", handler);
  };
}
export function onDisconnect(handler: () => void): () => void {
  const s = getProjectsSocket();
  s.on("disconnect", handler);
  return () => {
    s.off("disconnect", handler);
  };
}
export function isSocketConnected(): boolean {
  return socket?.connected ?? false;
}
