import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { MediaDTO, MediaKind, MediaListDTO } from '@lms/types';
import { Prisma } from '@prisma/client';
import { imageSize } from 'image-size';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { MediaStorage } from './media.storage';
import {
  isSvg,
  MAX_MEDIA_BYTES,
  mediaKind,
  resolveMediaExt,
  sanitizeSvg,
  svgDimensions,
  timestampName,
} from './media.config';
import { UpdateMediaDto } from './dto/media.dto';

type AssetRow = Prisma.MediaAssetGetPayload<{
  include: { uploadedBy: { select: { email: true } } };
}>;

const INCLUDE_UPLOADER = {
  uploadedBy: { select: { email: true } },
} as const;

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: MediaStorage,
  ) {}

  private toDTO(a: AssetRow, baseUrl: string): MediaDTO {
    const ext = path.extname(a.key).toLowerCase();
    return {
      id: a.id,
      url: `${baseUrl}/media/${a.key}`,
      key: a.key,
      originalName: a.originalName,
      mimeType: a.mimeType,
      kind: mediaKind(a.mimeType, ext),
      size: a.size,
      width: a.width,
      height: a.height,
      title: a.title,
      altText: a.altText,
      caption: a.caption,
      description: a.description,
      uploadedBy: a.uploadedBy ? { email: a.uploadedBy.email } : null,
      createdAt: a.createdAt.toISOString(),
    };
  }

  // Map a UI kind filter to a Prisma where clause (the common cases).
  private kindWhere(kind?: string): Prisma.MediaAssetWhereInput {
    switch (kind) {
      case 'image':
        return { mimeType: { startsWith: 'image/' } };
      case 'video':
        return { mimeType: { startsWith: 'video/' } };
      case 'audio':
        return { mimeType: { startsWith: 'audio/' } };
      case 'pdf':
        return { mimeType: 'application/pdf' };
      default:
        return {};
    }
  }

  async list(
    baseUrl: string,
    opts: { q?: string; kind?: string; page?: number; pageSize?: number },
  ): Promise<MediaListDTO> {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 40));
    const q = opts.q?.trim();
    const where: Prisma.MediaAssetWhereInput = {
      ...this.kindWhere(opts.kind),
      ...(q
        ? {
            OR: [
              { originalName: { contains: q, mode: 'insensitive' } },
              { title: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.mediaAsset.findMany({
        where,
        include: INCLUDE_UPLOADER,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.mediaAsset.count({ where }),
    ]);
    return { items: rows.map((r) => this.toDTO(r, baseUrl)), total, page, pageSize };
  }

  async get(id: string, baseUrl: string): Promise<MediaDTO> {
    const a = await this.prisma.mediaAsset.findUnique({
      where: { id },
      include: INCLUDE_UPLOADER,
    });
    if (!a) throw new NotFoundException('Media not found');
    return this.toDTO(a, baseUrl);
  }

  async upload(
    file: Express.Multer.File | undefined,
    baseUrl: string,
    uploadedById: string | null,
  ): Promise<MediaDTO> {
    if (!file) throw new BadRequestException('No file provided');
    const ext = resolveMediaExt(file.originalname, file.mimetype);
    if (!ext) {
      throw new BadRequestException(
        'That file type is not allowed (scripts, markup and executables are blocked).',
      );
    }
    if (file.size > MAX_MEDIA_BYTES) {
      throw new BadRequestException('File too large (max 100 MB).');
    }

    let buffer = file.buffer;
    let width: number | null = null;
    let height: number | null = null;
    let mimeType = file.mimetype;

    if (isSvg(file.mimetype, ext)) {
      // Sanitize SVGs before they're ever served publicly.
      buffer = Buffer.from(sanitizeSvg(buffer.toString('utf8')), 'utf8');
      mimeType = 'image/svg+xml';
      const d = svgDimensions(buffer.toString('utf8'));
      width = d.width;
      height = d.height;
    } else if (mediaKind(file.mimetype, ext) === 'image') {
      // Magic-byte check: a declared raster image MUST actually parse as one.
      // image-size reads the header, so a mislabeled file (e.g. HTML/script sent
      // as image/png) fails here and is REJECTED rather than stored + served.
      let d: { width?: number; height?: number } | null = null;
      try {
        d = imageSize(buffer);
      } catch {
        d = null;
      }
      if (!d?.width || !d?.height) {
        throw new BadRequestException(
          "That image couldn't be read — it may be corrupt or not a real image file.",
        );
      }
      width = d.width;
      height = d.height;
    }

    const key = timestampName(ext);
    await this.storage.put(key, buffer, mimeType);

    const created = await this.prisma.mediaAsset.create({
      data: {
        key,
        originalName: (file.originalname || key).slice(0, 255),
        mimeType,
        size: buffer.length,
        width,
        height,
        // Seed the title from the filename (sans extension), like WordPress.
        title: (file.originalname || '').replace(/\.[^.]+$/, '').slice(0, 300) || null,
        uploadedById,
      },
      include: INCLUDE_UPLOADER,
    });
    return this.toDTO(created, baseUrl);
  }

  async update(
    id: string,
    dto: UpdateMediaDto,
    baseUrl: string,
  ): Promise<MediaDTO> {
    const exists = await this.prisma.mediaAsset.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Media not found');
    const norm = (v?: string) => (v === undefined ? undefined : v.trim() || null);
    const updated = await this.prisma.mediaAsset.update({
      where: { id },
      data: {
        title: norm(dto.title),
        altText: norm(dto.altText),
        caption: norm(dto.caption),
        description: norm(dto.description),
      },
      include: INCLUDE_UPLOADER,
    });
    return this.toDTO(updated, baseUrl);
  }

  async remove(id: string): Promise<{ ok: true }> {
    const a = await this.prisma.mediaAsset.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Media not found');
    await this.prisma.mediaAsset.delete({ where: { id } });
    await this.storage.delete(a.key); // best-effort; row is the source of truth
    return { ok: true };
  }
}
