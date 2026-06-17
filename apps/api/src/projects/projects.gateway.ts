import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type {
  ChatMessageDTO,
  ChatReactionGroupDTO,
} from '@lms/types';
import { ChannelsService } from './channels.service';

// The realtime transport for Projects (Phase 3). Internal-staff only — the
// handshake JWT must be an admin token (payload.isAdmin === true), otherwise the
// socket is rejected before it can join any channel room.
//
// Rooms: one Socket.IO room per channel, named `channel:<channelId>`. A socket
// only joins after ChannelsService.assertVisible passes, so private-channel
// visibility is enforced on the realtime path exactly as on REST.
//
// DI: this gateway injects ONLY ChannelsService (for assertVisible) and
// JwtService (verify handshake). It does NOT inject MessagesService — that would
// create a cycle (MessagesService injects this gateway to broadcast). The
// dependency edges are: gateway -> ChannelsService, MessagesService -> gateway,
// MessagesService -> ChannelsService. All acyclic, so no forwardRef is needed.
@WebSocketGateway({
  namespace: '/projects',
  cors: { origin: true, credentials: true },
})
export class ProjectsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(ProjectsGateway.name);

  @WebSocketServer()
  server!: Server;

  // In-memory presence: adminId -> count of that admin's live sockets. An admin
  // is "online" while at least one of their sockets is connected; the refcount
  // tolerates multiple tabs without flicker.
  //
  // NOTE (multi-instance): this Set is per-process. With the Redis adapter, room
  // broadcasts fan out across instances, but PRESENCE does not — each instance
  // only knows its own sockets. A true cluster-wide presence set would track
  // membership in Redis (e.g. a sorted set with TTL heartbeats) and union across
  // instances. For v1 (single API instance) the in-memory refcount is sufficient.
  private readonly presence = new Map<string, number>();

  constructor(
    private readonly jwt: JwtService,
    private readonly channels: ChannelsService,
  ) {}

  // ----- Connection lifecycle -----

  async handleConnection(client: Socket): Promise<void> {
    const token = this.extractToken(client);
    if (!token) {
      this.logger.debug('Rejecting socket: no token');
      client.disconnect(true);
      return;
    }
    try {
      // Reuse AuthModule's JwtService (same secret) — see projects.module.ts.
      const payload = await this.jwt.verifyAsync<{
        sub: string;
        isAdmin?: boolean;
      }>(token);
      if (!payload || payload.isAdmin !== true || !payload.sub) {
        this.logger.debug('Rejecting socket: not an admin token');
        client.disconnect(true);
        return;
      }
      client.data.adminId = payload.sub;
      this.addPresence(payload.sub);
      this.broadcastPresence();
    } catch {
      this.logger.debug('Rejecting socket: invalid token');
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const adminId = client.data.adminId as string | undefined;
    if (adminId) {
      this.removePresence(adminId);
      this.broadcastPresence();
    }
  }

  // ----- Room membership -----

  @SubscribeMessage('channel:join')
  async onJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { channelId?: string },
  ): Promise<{ ok: boolean; channelId?: string; error?: string }> {
    const adminId = client.data.adminId as string | undefined;
    const channelId = body?.channelId;
    if (!adminId || !channelId) return { ok: false, error: 'bad request' };
    try {
      // Same visibility gate as REST (public OR a member of the private channel).
      await this.channels.assertVisible(adminId, channelId);
      await client.join(this.room(channelId));
      return { ok: true, channelId };
    } catch {
      return { ok: false, channelId, error: 'forbidden' };
    }
  }

  @SubscribeMessage('channel:leave')
  async onLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { channelId?: string },
  ): Promise<{ ok: boolean }> {
    const channelId = body?.channelId;
    if (channelId) await client.leave(this.room(channelId));
    return { ok: true };
  }

  // ----- Typing indicator (ephemeral; not persisted) -----

  @SubscribeMessage('typing')
  onTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { channelId?: string },
  ): void {
    const adminId = client.data.adminId as string | undefined;
    const channelId = body?.channelId;
    if (!adminId || !channelId) return;
    // Broadcast to everyone else in the room (not the sender).
    client
      .to(this.room(channelId))
      .emit('chat:typing', { channelId, adminId });
  }

  // ----- Public emit API (called by MessagesService after it persists) -----

  // A brand-new message (top-level or thread reply) was created.
  emitMessage(dto: ChatMessageDTO): void {
    this.server?.to(this.room(dto.channelId)).emit('chat:message', dto);
  }

  // An existing message changed (edit or soft-delete).
  emitMessageUpdate(dto: ChatMessageDTO): void {
    this.server?.to(this.room(dto.channelId)).emit('chat:message:update', dto);
  }

  // A message's reactions changed. Sends the recomputed grouped reactions so the
  // client can replace that message's chips without a refetch.
  emitReaction(
    channelId: string,
    messageId: string,
    reactions: ChatReactionGroupDTO[],
  ): void {
    this.server
      ?.to(this.room(channelId))
      .emit('chat:reaction', { messageId, reactions });
  }

  // A list's fields or items changed (custom-field edit, value merge, comment).
  // Broadcasts to the owning channel's room so open boards refresh. Stand-alone
  // lists (channelId === null) have no room, so this is a no-op for them.
  emitListUpdate(channelId: string | null, listId: string): void {
    if (!channelId) return;
    this.server
      ?.to(this.room(channelId))
      .emit('chat:list:update', { channelId, listId });
  }

  // ----- Internals -----

  private room(channelId: string): string {
    return `channel:${channelId}`;
  }

  private extractToken(client: Socket): string | null {
    const fromAuth = client.handshake.auth?.token;
    if (typeof fromAuth === 'string' && fromAuth) return fromAuth;
    const header = client.handshake.headers?.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      return header.slice('Bearer '.length).trim() || null;
    }
    return null;
  }

  private addPresence(adminId: string): void {
    this.presence.set(adminId, (this.presence.get(adminId) ?? 0) + 1);
  }

  private removePresence(adminId: string): void {
    const next = (this.presence.get(adminId) ?? 0) - 1;
    if (next <= 0) this.presence.delete(adminId);
    else this.presence.set(adminId, next);
  }

  private broadcastPresence(): void {
    const online = [...this.presence.keys()];
    this.server?.emit('chat:presence', { online });
  }
}
