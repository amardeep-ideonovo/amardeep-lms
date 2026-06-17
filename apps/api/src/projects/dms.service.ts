import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ChatChannelDTO, ChatDmDTO } from '@lms/types';
import { PrismaService } from '../prisma/prisma.service';

// Direct messages (DMs) for Projects — the "Direct messages" people list in the
// admin's Slack-style sidebar. A DM is just a ChatChannel with kind=DM/GROUP_DM,
// no meaningful name, isPrivate=true, and its participants in ChatMember. Every
// message/thread/reaction/unread mechanic already works on channels, so DM
// channels are reachable through the existing message endpoints unchanged
// (ChannelsService.assertVisible only requires private-channel membership, which
// DM members have).
//
// Dedupe: a DM between the same set of people must resolve to ONE channel. We
// compute a deterministic `dmKey` = the sorted member ids joined by ":" and put
// a @unique on ChatChannel.dmKey. Open-or-get looks up by dmKey first; the
// create path also defends against the P2002 race (two admins opening the same
// DM at once → the loser re-reads the winner's row).
@Injectable()
export class DmsService {
  constructor(private readonly prisma: PrismaService) {}

  // Build the canonical member set (actor always included) + the dmKey for it.
  private resolveMembers(actorAdminId: string, adminIds: string[]) {
    const members = Array.from(
      new Set([actorAdminId, ...adminIds.map((id) => id.trim()).filter(Boolean)]),
    );
    if (members.length < 2) {
      throw new BadRequestException(
        'A direct message needs at least one other person.',
      );
    }
    // Sorted so the key is identical no matter who opens it or in what order.
    const sorted = [...members].sort();
    return { members: sorted, dmKey: sorted.join(':') };
  }

  // ----- Open-or-get a DM -----
  async openDm(
    actorAdminId: string,
    adminIds: string[],
  ): Promise<ChatChannelDTO> {
    const { members, dmKey } = this.resolveMembers(actorAdminId, adminIds);
    const kind = members.length === 2 ? 'DM' : 'GROUP_DM';

    // Already exists? Return it.
    const existing = await this.prisma.chatChannel.findUnique({
      where: { dmKey },
    });
    if (existing) return this.toDmChannelDTO(actorAdminId, existing.id);

    // Create the channel + a member row per participant.
    try {
      const created = await this.prisma.chatChannel.create({
        data: {
          name: '',
          kind,
          dmKey,
          isPrivate: true,
          createdByAdminId: actorAdminId,
          members: { create: members.map((adminId) => ({ adminId })) },
        },
      });
      return this.toDmChannelDTO(actorAdminId, created.id);
    } catch (err) {
      // Race: another request created the same dmKey first — re-read it.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const raced = await this.prisma.chatChannel.findUnique({
          where: { dmKey },
        });
        if (raced) return this.toDmChannelDTO(actorAdminId, raced.id);
      }
      throw err;
    }
  }

  // Serialize a DM channel into a ChatChannelDTO including its member admin ids
  // + this admin's unread/mention counts (same computation channels use).
  private async toDmChannelDTO(
    adminId: string,
    channelId: string,
  ): Promise<ChatChannelDTO> {
    const channel = await this.prisma.chatChannel.findUniqueOrThrow({
      where: { id: channelId },
      include: { members: { orderBy: { joinedAt: 'asc' } } },
    });
    const memberAdminIds = channel.members.map((m) => m.adminId);
    const myMembership = channel.members.find((m) => m.adminId === adminId);
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
      id: channel.id,
      name: channel.name,
      slug: channel.slug,
      topic: channel.topic,
      isPrivate: channel.isPrivate,
      kind: channel.kind,
      memberAdminIds,
      archivedAt: channel.archivedAt ? channel.archivedAt.toISOString() : null,
      unreadCount,
      mentionCount,
      memberCount: channel.members.length,
    };
  }

  // ----- List the actor's DMs (most-recent activity first) -----
  async listDms(adminId: string): Promise<ChatDmDTO[]> {
    const myMemberships = await this.prisma.chatMember.findMany({
      where: {
        adminId,
        channel: { kind: { in: ['DM', 'GROUP_DM'] } },
      },
      select: {
        lastReadSeq: true,
        channel: {
          select: {
            id: true,
            kind: true,
            members: { select: { adminId: true } },
          },
        },
      },
    });

    const dms = await Promise.all(
      myMemberships.map(async (m) => {
        const channelId = m.channel.id;
        const lastReadSeq = m.lastReadSeq;
        const [unreadCount, mentionCount, lastMessage] = await Promise.all([
          this.prisma.chatMessage.count({
            where: {
              channelId,
              deletedAt: null,
              seq: { gt: lastReadSeq },
              authorAdminId: { not: adminId },
            },
          }),
          this.prisma.chatMention.count({
            where: {
              mentionedAdminId: adminId,
              message: { channelId, deletedAt: null, seq: { gt: lastReadSeq } },
            },
          }),
          this.prisma.chatMessage.findFirst({
            where: { channelId, deletedAt: null },
            orderBy: { seq: 'desc' },
            select: { createdAt: true },
          }),
        ]);
        const dto: ChatDmDTO = {
          id: channelId,
          kind: m.channel.kind,
          otherAdminIds: m.channel.members
            .map((mm) => mm.adminId)
            .filter((id) => id !== adminId),
          unreadCount,
          mentionCount,
          lastMessageAt: lastMessage
            ? lastMessage.createdAt.toISOString()
            : null,
        };
        return dto;
      }),
    );

    // Most-recent activity first; DMs with no messages sink to the bottom.
    return dms.sort((a, b) => {
      const ta = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
      const tb = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
      return tb - ta;
    });
  }
}
