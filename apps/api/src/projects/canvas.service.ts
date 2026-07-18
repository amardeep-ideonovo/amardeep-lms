import { Injectable, NotFoundException } from '@nestjs/common';
import type { ChatCanvas } from '@prisma/client';
import sanitizeHtml from 'sanitize-html';
import { ALLOWED_STYLES } from '../common/sanitize-styles';
import type {
  ChatCanvasDTO,
  CreateCanvasInput,
  UpdateCanvasInput,
} from '@lms/types';
import { PrismaService } from '../prisma/prisma.service';

// Canvas docs: rich-text documents pinned to a channel as header tabs (the Slack
// "Web SOP" tab). A channel hosts MANY canvases, ordered by position, alongside
// the Messages tab and its Lists. Content is editor HTML.
//
// This is a PRISMA-ONLY LEAF service — it injects nothing but PrismaService, so
// it adds no edge to the projects DI graph (which stays acyclic; see
// projects.module.ts). Channel-visibility is not re-checked here: every route
// is already behind the admin-only `projects` RBAC guard, matching how the rest
// of the admin Projects surface treats canvas/list reads.
//
// Although these docs are admin-only (never shown to logged-out visitors), the
// stored HTML is sanitized on write as defense-in-depth — mirroring blog/pages.
const SANITIZE_OPTS: sanitizeHtml.IOptions = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'blockquote', 'a', 'ul', 'ol',
    'li', 'b', 'i', 'strong', 'em', 's', 'strike', 'code', 'pre', 'hr', 'br',
    'span', 'img', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tr',
    'th', 'td',
  ],
  allowedAttributes: {
    a: ['href', 'name', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    '*': ['style'],
  },
  allowedStyles: ALLOWED_STYLES,
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  transformTags: {
    a: sanitizeHtml.simpleTransform(
      'a',
      { rel: 'noopener noreferrer', target: '_blank' },
      true,
    ),
  },
};

@Injectable()
export class CanvasService {
  constructor(private readonly prisma: PrismaService) {}

  // ----- Serializer -----

  private toDTO(canvas: ChatCanvas): ChatCanvasDTO {
    return {
      id: canvas.id,
      channelId: canvas.channelId,
      title: canvas.title,
      content: canvas.content,
      position: canvas.position,
      updatedAt: canvas.updatedAt.toISOString(),
    };
  }

  // ----- List a channel's canvases (full content; ordered by position) -----

  async listCanvases(
    adminId: string,
    channelId: string,
  ): Promise<ChatCanvasDTO[]> {
    await this.assertChannel(channelId);
    const canvases = await this.prisma.chatCanvas.findMany({
      where: { channelId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
    return canvases.map((c) => this.toDTO(c));
  }

  // ----- Create (defaults to the bottom of the tab order) -----

  async createCanvas(
    adminId: string,
    channelId: string,
    input: CreateCanvasInput,
  ): Promise<ChatCanvasDTO> {
    await this.assertChannel(channelId);
    const position =
      input.position ??
      ((
        await this.prisma.chatCanvas.findFirst({
          where: { channelId },
          orderBy: { position: 'desc' },
          select: { position: true },
        })
      )?.position ?? -1) + 1;
    const canvas = await this.prisma.chatCanvas.create({
      data: {
        channelId,
        title: input.title.trim(),
        content: input.content ? sanitizeHtml(input.content, SANITIZE_OPTS) : '',
        position,
        createdByAdminId: adminId,
      },
    });
    return this.toDTO(canvas);
  }

  // ----- Update {title?, content?, position?} -----

  async updateCanvas(
    adminId: string,
    canvasId: string,
    input: UpdateCanvasInput,
  ): Promise<ChatCanvasDTO> {
    await this.assertCanvas(canvasId);
    const canvas = await this.prisma.chatCanvas.update({
      where: { id: canvasId },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.content !== undefined
          ? { content: sanitizeHtml(input.content, SANITIZE_OPTS) }
          : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
      },
    });
    return this.toDTO(canvas);
  }

  // ----- Delete -----

  async deleteCanvas(
    adminId: string,
    canvasId: string,
  ): Promise<{ ok: true }> {
    await this.assertCanvas(canvasId);
    await this.prisma.chatCanvas.delete({ where: { id: canvasId } });
    return { ok: true };
  }

  // ----- Internal guards -----

  private async assertChannel(channelId: string): Promise<void> {
    const channel = await this.prisma.chatChannel.findUnique({
      where: { id: channelId },
      select: { id: true },
    });
    if (!channel) throw new NotFoundException('Channel not found');
  }

  private async assertCanvas(canvasId: string): Promise<void> {
    const canvas = await this.prisma.chatCanvas.findUnique({
      where: { id: canvasId },
      select: { id: true },
    });
    if (!canvas) throw new NotFoundException('Canvas not found');
  }
}
