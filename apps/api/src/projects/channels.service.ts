import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ChatChannel, ChatMember } from '@prisma/client';
import type {
  ChatChannelDetailDTO,
  ChatChannelDTO,
  CreateChatChannelInput,
  UpdateChatChannelInput,
} from '@lms/types';
import { PrismaService } from '../prisma/prisma.service';

// Channels: public ones everyone can see + private ones only members see. The
// acting admin id is always passed in (controller reads it off the JWT via
// @CurrentUser().sub) — services never trust a client-supplied admin id.
@Injectable()
export class ChannelsService {
  constructor(private readonly prisma: PrismaService) {}

  // ----- Serializers -----

  private toChannelDTO(
    channel: ChatChannel,
    counts: { unreadCount: number; mentionCount: number; memberCount: number },
  ): ChatChannelDTO {
    return {
      id: channel.id,
      name: channel.name,
      slug: channel.slug,
      topic: channel.topic,
      isPrivate: channel.isPrivate,
      kind: channel.kind,
      archivedAt: channel.archivedAt ? channel.archivedAt.toISOString() : null,
      unreadCount: counts.unreadCount,
      mentionCount: counts.mentionCount,
      memberCount: counts.memberCount,
    };
  }

  // ----- Channel list (visible to this admin, each with unread counts) -----

  async listChannels(adminId: string): Promise<ChatChannelDTO[]> {
    // Visible = public channels OR private channels this admin is a member of.
    const myMemberships = await this.prisma.chatMember.findMany({
      where: { adminId },
      select: { channelId: true, lastReadSeq: true },
    });
    const memberByChannel = new Map(
      myMemberships.map((m) => [m.channelId, m]),
    );

    const channels = await this.prisma.chatChannel.findMany({
      where: {
        // Only regular channels here — DM/GROUP_DM channels live in their own
        // "Direct messages" rail (GET /admin/projects/dms), never this list.
        kind: 'CHANNEL',
        OR: [
          { isPrivate: false },
          { id: { in: myMemberships.map((m) => m.channelId) } },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });

    return Promise.all(
      channels.map(async (channel) => {
        const membership = memberByChannel.get(channel.id);
        const lastReadSeq = membership?.lastReadSeq ?? 0;
        const [unreadCount, mentionCount, memberCount] = await Promise.all([
          // Non-members of a public channel haven't read anything, but they also
          // aren't tracked — surface 0 unread until they join (lastReadSeq=0
          // would otherwise count the whole history).
          membership
            ? this.prisma.chatMessage.count({
                where: {
                  channelId: channel.id,
                  deletedAt: null,
                  seq: { gt: lastReadSeq },
                  authorAdminId: { not: adminId },
                },
              })
            : Promise.resolve(0),
          membership
            ? this.prisma.chatMention.count({
                where: {
                  mentionedAdminId: adminId,
                  message: {
                    channelId: channel.id,
                    deletedAt: null,
                    seq: { gt: lastReadSeq },
                  },
                },
              })
            : Promise.resolve(0),
          this.prisma.chatMember.count({ where: { channelId: channel.id } }),
        ]);
        return this.toChannelDTO(channel, {
          unreadCount,
          mentionCount,
          memberCount,
        });
      }),
    );
  }

  // ----- Channel detail (+ members) -----

  async getChannelDetail(
    adminId: string,
    channelId: string,
  ): Promise<ChatChannelDetailDTO> {
    const channel = await this.prisma.chatChannel.findUnique({
      where: { id: channelId },
      include: {
        members: { orderBy: { joinedAt: 'asc' } },
        // Tab-bar inputs: the channel's Lists (queue tabs) and Canvas docs, both
        // ordered by position. Just the id + label the UI needs to render tabs;
        // full contents load on tab-select (listLists / canvases GET).
        lists: {
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
          select: { id: true, name: true },
        },
        canvases: {
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
          select: { id: true, title: true },
        },
      },
    });
    if (!channel) throw new NotFoundException('Channel not found');
    const members = channel.members as ChatMember[];
    const myMembership = members.find((m) => m.adminId === adminId) ?? null;
    if (channel.isPrivate && !myMembership) {
      throw new ForbiddenException('This channel is private');
    }
    const lastReadSeq = myMembership?.lastReadSeq ?? 0;
    const [unreadCount, mentionCount] = await Promise.all([
      myMembership
        ? this.prisma.chatMessage.count({
            where: {
              channelId,
              deletedAt: null,
              seq: { gt: lastReadSeq },
              authorAdminId: { not: adminId },
            },
          })
        : Promise.resolve(0),
      myMembership
        ? this.prisma.chatMention.count({
            where: {
              mentionedAdminId: adminId,
              message: { channelId, deletedAt: null, seq: { gt: lastReadSeq } },
            },
          })
        : Promise.resolve(0),
    ]);
    return {
      ...this.toChannelDTO(channel, {
        unreadCount,
        mentionCount,
        memberCount: members.length,
      }),
      members: members.map((m) => ({
        adminId: m.adminId,
        role: null,
        joinedAt: m.joinedAt.toISOString(),
      })),
      lists: channel.lists.map((l) => ({ id: l.id, name: l.name })),
      canvases: channel.canvases.map((c) => ({ id: c.id, title: c.title })),
    };
  }

  // ----- Create (creator auto-joins) -----

  async createChannel(
    adminId: string,
    input: CreateChatChannelInput,
  ): Promise<ChatChannelDetailDTO> {
    const channel = await this.prisma.chatChannel.create({
      data: {
        name: input.name.trim(),
        topic: input.topic?.trim() || null,
        isPrivate: input.isPrivate ?? false,
        createdByAdminId: adminId,
        members: { create: { adminId } },
      },
    });
    return this.getChannelDetail(adminId, channel.id);
  }

  // ----- Update {name?, topic?, archived?} -----

  async updateChannel(
    adminId: string,
    channelId: string,
    input: UpdateChatChannelInput,
  ): Promise<ChatChannelDetailDTO> {
    await this.assertVisible(adminId, channelId);
    await this.prisma.chatChannel.update({
      where: { id: channelId },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.topic !== undefined
          ? { topic: input.topic ? input.topic.trim() : null }
          : {}),
        ...(input.archived !== undefined
          ? { archivedAt: input.archived ? new Date() : null }
          : {}),
      },
    });
    return this.getChannelDetail(adminId, channelId);
  }

  // ----- Membership (own) -----

  async join(
    adminId: string,
    channelId: string,
  ): Promise<ChatChannelDetailDTO> {
    const channel = await this.prisma.chatChannel.findUnique({
      where: { id: channelId },
      select: { id: true },
    });
    if (!channel) throw new NotFoundException('Channel not found');
    // Idempotent: the [channelId, adminId] unique makes a re-join a no-op.
    await this.prisma.chatMember.upsert({
      where: { channelId_adminId: { channelId, adminId } },
      create: { channelId, adminId },
      update: {},
    });
    return this.getChannelDetail(adminId, channelId);
  }

  async leave(adminId: string, channelId: string): Promise<{ ok: true }> {
    await this.prisma.chatMember.deleteMany({ where: { channelId, adminId } });
    return { ok: true };
  }

  // ----- Internal guards (shared with MessagesService via the module) -----

  async assertVisible(adminId: string, channelId: string): Promise<ChatChannel> {
    const channel = await this.prisma.chatChannel.findUnique({
      where: { id: channelId },
    });
    if (!channel) throw new NotFoundException('Channel not found');
    if (channel.isPrivate) {
      const membership = await this.prisma.chatMember.findUnique({
        where: { channelId_adminId: { channelId, adminId } },
        select: { id: true },
      });
      if (!membership) throw new ForbiddenException('This channel is private');
    }
    return channel;
  }
}
