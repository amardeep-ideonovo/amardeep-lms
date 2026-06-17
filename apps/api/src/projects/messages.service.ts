import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ChatMessage, ChatReaction } from '@prisma/client';
import type {
  ChatListItemDTO,
  ChatMessageDTO,
  MessageToTaskInput,
  SendMessageInput,
  UnreadSummaryDTO,
} from '@lms/types';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelsService } from './channels.service';
import { ListsService } from './lists.service';
import { ProjectsGateway } from './projects.gateway';
import { WorkflowsService } from './workflows.service';

// A ChatMessage row plus the relations the DTO needs (reactions + a reply
// count). Loaded together so serialization is a pure function.
type MessageWithExtras = ChatMessage & {
  reactions: ChatReaction[];
  _count: { replies: number };
};

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly channels: ChannelsService,
    private readonly lists: ListsService,
    // Realtime broadcaster (Phase 3). Safe to inject: the gateway does NOT depend
    // back on MessagesService, so there's no DI cycle (see projects.module.ts).
    private readonly gateway: ProjectsGateway,
    // Workflows engine: source of the message-DTO enrichments (inline item cards
    // + workflow author name). WorkflowsService does NOT inject MessagesService
    // back, so this edge is acyclic.
    private readonly workflows: WorkflowsService,
  ) {}

  // Standard include so every read returns a fully-serializable message.
  private static readonly messageInclude = {
    reactions: true,
    _count: { select: { replies: true } },
  } as const;

  // ----- Serializer -----

  // Public so a future realtime gateway (Phase 3) can broadcast the exact DTO
  // that createMessage returns without reaching into Prisma rows itself.
  toMessageDTO(message: MessageWithExtras): ChatMessageDTO {
    // Group reactions by emoji -> the admins who used it (stable insertion order).
    const byEmoji = new Map<string, string[]>();
    for (const r of message.reactions) {
      const ids = byEmoji.get(r.emoji);
      if (ids) ids.push(r.adminId);
      else byEmoji.set(r.emoji, [r.adminId]);
    }
    return {
      id: message.id,
      seq: message.seq,
      channelId: message.channelId,
      authorAdminId: message.authorAdminId,
      body: message.body,
      parentMessageId: message.parentMessageId,
      createdAt: message.createdAt.toISOString(),
      editedAt: message.editedAt ? message.editedAt.toISOString() : null,
      deletedAt: message.deletedAt ? message.deletedAt.toISOString() : null,
      reactions: [...byEmoji.entries()].map(([emoji, adminIds]) => ({
        emoji,
        adminIds,
      })),
      replyCount: message._count.replies,
    };
  }

  // Enrich a batch of already-serialized DTOs with the workflow/list-item extras
  // (inline item card + workflow author name) for any message that references a
  // list item or was posted by a workflow. Two batched queries via Workflows
  // Service — no N+1. Mutates + returns the same array. A row whose card/workflow
  // was deleted simply gets no enrichment (the base DTO renders normally).
  private async enrichMessages(
    rows: MessageWithExtras[],
    dtos: ChatMessageDTO[],
  ): Promise<ChatMessageDTO[]> {
    const listItemIds: string[] = [];
    const workflowIds: string[] = [];
    for (const r of rows) {
      if (r.listItemId) listItemIds.push(r.listItemId);
      if (r.workflowId) workflowIds.push(r.workflowId);
    }
    if (listItemIds.length === 0 && workflowIds.length === 0) return dtos;

    const { cards, workflowNames } =
      await this.workflows.loadMessageEnrichments({ listItemIds, workflowIds });

    rows.forEach((r, i) => {
      const dto = dtos[i];
      if (r.workflowId) {
        dto.workflowId = r.workflowId;
        dto.workflowName = workflowNames.get(r.workflowId) ?? null;
      }
      if (r.listItemId) {
        dto.listItemCard = cards.get(r.listItemId) ?? null;
      }
    });
    return dtos;
  }

  // Serialize + enrich a batch of message rows in one call (history, replies).
  private async serializeMany(
    rows: MessageWithExtras[],
  ): Promise<ChatMessageDTO[]> {
    const dtos = rows.map((m) => this.toMessageDTO(m));
    return this.enrichMessages(rows, dtos);
  }

  // Serialize + enrich a single message row (send/edit/delete/react/single read).
  private async serializeOne(row: MessageWithExtras): Promise<ChatMessageDTO> {
    const [dto] = await this.enrichMessages([row], [this.toMessageDTO(row)]);
    return dto;
  }

  private async loadMessage(id: string): Promise<MessageWithExtras> {
    const message = await this.prisma.chatMessage.findUnique({
      where: { id },
      include: MessagesService.messageInclude,
    });
    if (!message) throw new NotFoundException('Message not found');
    return message as MessageWithExtras;
  }

  // ----- History / catch-up -----

  async listMessages(
    adminId: string,
    channelId: string,
    opts: { afterSeq?: number; limit?: number },
  ): Promise<ChatMessageDTO[]> {
    await this.channels.assertVisible(adminId, channelId);
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const messages = await this.prisma.chatMessage.findMany({
      where: {
        channelId,
        deletedAt: null,
        ...(opts.afterSeq !== undefined
          ? { seq: { gt: opts.afterSeq } }
          : {}),
      },
      orderBy: { seq: 'asc' },
      take: limit,
      include: MessagesService.messageInclude,
    });
    return this.serializeMany(messages as MessageWithExtras[]);
  }

  // ----- Send -----

  async createMessage(
    adminId: string,
    channelId: string,
    input: SendMessageInput,
  ): Promise<ChatMessageDTO> {
    await this.channels.assertVisible(adminId, channelId);

    // A thread reply must point at a live message in the same channel.
    if (input.parentMessageId) {
      const parent = await this.prisma.chatMessage.findUnique({
        where: { id: input.parentMessageId },
        select: { channelId: true, deletedAt: true },
      });
      if (!parent || parent.channelId !== channelId || parent.deletedAt) {
        throw new NotFoundException('Parent message not found in this channel');
      }
    }

    const mentioned = [...new Set(input.mentionedAdminIds ?? [])];
    const message = await this.prisma.chatMessage.create({
      data: {
        channelId,
        authorAdminId: adminId,
        body: input.body,
        parentMessageId: input.parentMessageId ?? null,
        ...(mentioned.length
          ? {
              mentions: {
                create: mentioned.map((mentionedAdminId) => ({
                  mentionedAdminId,
                })),
              },
            }
          : {}),
      },
      include: MessagesService.messageInclude,
    });

    // The sender has implicitly "read" up to their own message — advance their
    // last-read so their own send never shows as unread. Upsert so sending into
    // a public channel they haven't joined still tracks read state.
    await this.prisma.chatMember.upsert({
      where: { channelId_adminId: { channelId, adminId } },
      create: { channelId, adminId, lastReadSeq: message.seq, lastReadAt: new Date() },
      update: { lastReadSeq: message.seq, lastReadAt: new Date() },
    });

    // Phase 3: broadcast the new message to everyone subscribed to the channel
    // room. The sender already has it (REST returns the same DTO and the client
    // upserts by id), so a duplicate delivery is harmless. A normal send carries
    // no listItemId/workflowId, so enrichment is a no-op fast path here.
    const dto = await this.serializeOne(message as MessageWithExtras);
    this.gateway.emitMessage(dto);
    return dto;
  }

  // ----- Edit own message -----

  async editMessage(
    adminId: string,
    messageId: string,
    body: string,
  ): Promise<ChatMessageDTO> {
    const message = await this.loadMessage(messageId);
    if (message.authorAdminId !== adminId) {
      throw new ForbiddenException('You can only edit your own messages');
    }
    if (message.deletedAt) {
      throw new ForbiddenException('Cannot edit a deleted message');
    }
    const updated = await this.prisma.chatMessage.update({
      where: { id: messageId },
      data: { body, editedAt: new Date() },
      include: MessagesService.messageInclude,
    });
    const dto = await this.serializeOne(updated as MessageWithExtras);
    this.gateway.emitMessageUpdate(dto);
    return dto;
  }

  // ----- Soft-delete own message -----

  async deleteMessage(
    adminId: string,
    messageId: string,
  ): Promise<ChatMessageDTO> {
    const message = await this.loadMessage(messageId);
    if (message.authorAdminId !== adminId) {
      throw new ForbiddenException('You can only delete your own messages');
    }
    // Soft-delete: keep the row (threads/lists may reference it) but blank body.
    const updated = await this.prisma.chatMessage.update({
      where: { id: messageId },
      data: { deletedAt: message.deletedAt ?? new Date(), body: '' },
      include: MessagesService.messageInclude,
    });
    const dto = await this.serializeOne(updated as MessageWithExtras);
    // Soft-delete is rendered as an update (body blanked, deletedAt set) so live
    // clients swap to the "message deleted" placeholder.
    this.gateway.emitMessageUpdate(dto);
    return dto;
  }

  // ----- Thread replies -----

  async listReplies(
    adminId: string,
    messageId: string,
  ): Promise<ChatMessageDTO[]> {
    const parent = await this.prisma.chatMessage.findUnique({
      where: { id: messageId },
      select: { channelId: true },
    });
    if (!parent) throw new NotFoundException('Message not found');
    await this.channels.assertVisible(adminId, parent.channelId);
    const replies = await this.prisma.chatMessage.findMany({
      where: { parentMessageId: messageId, deletedAt: null },
      orderBy: { seq: 'asc' },
      include: MessagesService.messageInclude,
    });
    return this.serializeMany(replies as MessageWithExtras[]);
  }

  // ----- Toggle reaction -----

  async toggleReaction(
    adminId: string,
    messageId: string,
    emoji: string,
  ): Promise<ChatMessageDTO> {
    const message = await this.prisma.chatMessage.findUnique({
      where: { id: messageId },
      select: { channelId: true, deletedAt: true },
    });
    if (!message || message.deletedAt) {
      throw new NotFoundException('Message not found');
    }
    await this.channels.assertVisible(adminId, message.channelId);
    const existing = await this.prisma.chatReaction.findUnique({
      where: {
        messageId_adminId_emoji: { messageId, adminId, emoji },
      },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.chatReaction.delete({ where: { id: existing.id } });
    } else {
      await this.prisma.chatReaction.create({
        data: { messageId, adminId, emoji },
      });
    }
    const dto = await this.serializeOne(await this.loadMessage(messageId));
    // Broadcast just the recomputed grouped reactions for this message; live
    // clients patch the chips in place (no full-message refetch).
    this.gateway.emitReaction(message.channelId, dto.id, dto.reactions);
    return dto;
  }

  // ----- Mark channel read -----

  async markRead(
    adminId: string,
    channelId: string,
    seq?: number,
  ): Promise<{ ok: true }> {
    await this.channels.assertVisible(adminId, channelId);
    let targetSeq = seq;
    if (targetSeq === undefined) {
      const top = await this.prisma.chatMessage.findFirst({
        where: { channelId },
        orderBy: { seq: 'desc' },
        select: { seq: true },
      });
      targetSeq = top?.seq ?? 0;
    }
    await this.prisma.chatMember.upsert({
      where: { channelId_adminId: { channelId, adminId } },
      create: {
        channelId,
        adminId,
        lastReadSeq: targetSeq,
        lastReadAt: new Date(),
      },
      update: { lastReadSeq: targetSeq, lastReadAt: new Date() },
    });
    return { ok: true };
  }

  // ----- Unread summary (the batch endpoint) -----

  async unreadSummary(adminId: string): Promise<UnreadSummaryDTO> {
    // Every channel the admin is a member of, with their last-read marker.
    const memberships = await this.prisma.chatMember.findMany({
      where: { adminId },
      select: { channelId: true, lastReadSeq: true },
    });

    const channels = await Promise.all(
      memberships.map(async (m) => {
        const [unreadCount, mentionCount] = await Promise.all([
          this.prisma.chatMessage.count({
            where: {
              channelId: m.channelId,
              deletedAt: null,
              seq: { gt: m.lastReadSeq },
              authorAdminId: { not: adminId },
            },
          }),
          this.prisma.chatMention.count({
            where: {
              mentionedAdminId: adminId,
              message: {
                channelId: m.channelId,
                deletedAt: null,
                seq: { gt: m.lastReadSeq },
              },
            },
          }),
        ]);
        return { channelId: m.channelId, unreadCount, mentionCount };
      }),
    );

    // Only surface channels that actually have something unread.
    const withUnread = channels.filter((c) => c.unreadCount > 0);
    return {
      channels: withUnread,
      totalUnread: withUnread.reduce((sum, c) => sum + c.unreadCount, 0),
      unreadChannels: withUnread.length,
      totalMentions: channels.reduce((sum, c) => sum + c.mentionCount, 0),
    };
  }

  // ----- Turn a message into a task -----

  async messageToTask(
    adminId: string,
    messageId: string,
    input: MessageToTaskInput,
  ): Promise<ChatListItemDTO> {
    const message = await this.prisma.chatMessage.findUnique({
      where: { id: messageId },
      select: { id: true, channelId: true, body: true, deletedAt: true },
    });
    if (!message || message.deletedAt) {
      throw new NotFoundException('Message not found');
    }
    await this.channels.assertVisible(adminId, message.channelId);
    // Title = the message body, truncated to keep list rows tidy.
    const title = message.body.trim().slice(0, 200) || 'Untitled task';
    return this.lists.addItem(adminId, input.listId, {
      title,
      createdFromMessageId: message.id,
    });
  }
}
