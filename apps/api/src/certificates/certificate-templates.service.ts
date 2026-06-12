import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { imageSize } from 'image-size';
import type { Prisma, CertificateTemplate } from '@prisma/client';
import type { CertificateFieldLayout, CertificateTemplateDTO } from '@lms/types';
import { PrismaService } from '../prisma/prisma.service';
import { MEDIA_ROOT, MEDIA_ROUTE } from '../media/media.config';
import { CERT_FONT_IDS } from './certificates.config';

const FIELD_KINDS = ['memberName', 'className', 'issueDate', 'serial'] as const;
const ALIGNS = ['left', 'center', 'right'] as const;
const FONT_IDS = CERT_FONT_IDS;
// Always-on fields: a certificate without the member or class name is useless.
const REQUIRED_KINDS = new Set(['memberName', 'className']);

type TemplateRow = CertificateTemplate & { _count?: { certificates: number } };

@Injectable()
export class CertificateTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- mapping ----------

  private toDTO(row: TemplateRow): CertificateTemplateDTO {
    return {
      id: row.id,
      name: row.name,
      artworkUrl: row.artworkUrl,
      imageWidth: row.imageWidth,
      imageHeight: row.imageHeight,
      fields: this.normalizeFields(row.fields),
      isDefault: row.isDefault,
      issuedCount: row._count?.certificates ?? 0,
      createdAt: row.createdAt.toISOString(),
    };
  }

  // ---------- field-layout normalization ----------

  // The drag editor sends CertificateFieldLayout[]; clamp every numeric into
  // its sane range and whitelist enums so a buggy/hostile client can't store
  // unusable layouts. Unknown kinds are dropped; duplicates keep the first.
  normalizeFields(input: unknown): CertificateFieldLayout[] {
    const out: CertificateFieldLayout[] = [];
    const seen = new Set<string>();
    for (const raw of Array.isArray(input) ? input : []) {
      if (!raw || typeof raw !== 'object') continue;
      const f = raw as Record<string, unknown>;
      const kind = FIELD_KINDS.find((k) => k === f.kind);
      if (!kind || seen.has(kind)) continue;
      seen.add(kind);
      const num = (v: unknown, min: number, max: number, dflt: number) => {
        const n = typeof v === 'number' && Number.isFinite(v) ? v : dflt;
        return Math.min(max, Math.max(min, n));
      };
      const color =
        typeof f.color === 'string' && /^#[0-9a-f]{6}$/i.test(f.color)
          ? f.color.toLowerCase()
          : '#101828';
      const fontFamily = FONT_IDS.find((id) => id === f.fontFamily) ?? 'playfair';
      const align = ALIGNS.find((a) => a === f.align) ?? 'center';
      const letterSpacing =
        typeof f.letterSpacing === 'number' && Number.isFinite(f.letterSpacing)
          ? Math.min(1, Math.max(0, f.letterSpacing))
          : undefined;
      out.push({
        kind,
        enabled: REQUIRED_KINDS.has(kind) ? true : f.enabled !== false,
        xPct: num(f.xPct, 0, 100, 10),
        yPct: num(f.yPct, 0, 100, 40),
        widthPct: num(f.widthPct, 5, 100, 80),
        align,
        fontFamily,
        fontSizePct: num(f.fontSizePct, 0.5, 20, 5),
        color,
        uppercase: f.uppercase === true,
        ...(letterSpacing !== undefined ? { letterSpacing } : {}),
      });
    }
    // Guarantee the two required fields exist even if the client omitted them.
    if (!seen.has('memberName')) {
      out.push({
        kind: 'memberName', enabled: true, xPct: 10, yPct: 42, widthPct: 80,
        align: 'center', fontFamily: 'greatvibes', fontSizePct: 7, color: '#101828', uppercase: false,
      });
    }
    if (!seen.has('className')) {
      out.push({
        kind: 'className', enabled: true, xPct: 10, yPct: 58, widthPct: 80,
        align: 'center', fontFamily: 'playfair', fontSizePct: 3.6, color: '#101828', uppercase: false,
      });
    }
    return out;
  }

  // ---------- artwork resolution ----------

  // Templates may only reference LOCAL media-library uploads so PDF renders
  // never fetch remote bytes. Accepts "/media/<key>" or an absolute URL with
  // that pathname; returns the stored path form + measured pixel size.
  private resolveArtwork(urlInput: string): {
    artworkUrl: string;
    imageWidth: number;
    imageHeight: number;
  } {
    let pathname = urlInput.trim();
    try {
      if (/^https?:\/\//i.test(pathname)) pathname = new URL(pathname).pathname;
    } catch {
      throw new BadRequestException('Invalid artwork URL');
    }
    const prefix = `${MEDIA_ROUTE}/`;
    if (!pathname.startsWith(prefix)) {
      throw new BadRequestException(
        'Artwork must be an image from the media library (/media/… URL)',
      );
    }
    const key = pathname.slice(prefix.length);
    if (!/^[A-Za-z0-9._-]+$/.test(key)) {
      throw new BadRequestException('Invalid artwork URL');
    }
    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(path.join(MEDIA_ROOT, key));
    } catch {
      throw new BadRequestException('Artwork file not found in the media library');
    }
    const isPng = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50;
    const isJpg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;
    if (!isPng && !isJpg) {
      throw new BadRequestException('Artwork must be a PNG or JPEG image');
    }
    let dims: { width?: number; height?: number };
    try {
      dims = imageSize(bytes);
    } catch {
      throw new BadRequestException('Could not read artwork image dimensions');
    }
    if (!dims.width || !dims.height) {
      throw new BadRequestException('Could not read artwork image dimensions');
    }
    return { artworkUrl: pathname, imageWidth: dims.width, imageHeight: dims.height };
  }

  // ---------- CRUD ----------

  private readonly withCount = { _count: { select: { certificates: true } } } as const;

  async list(): Promise<CertificateTemplateDTO[]> {
    const rows = await this.prisma.certificateTemplate.findMany({
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      include: this.withCount,
    });
    return rows.map((r) => this.toDTO(r));
  }

  async get(id: string): Promise<CertificateTemplateDTO> {
    const row = await this.prisma.certificateTemplate.findUnique({
      where: { id },
      include: this.withCount,
    });
    if (!row) throw new NotFoundException('Template not found');
    return this.toDTO(row);
  }

  async create(input: {
    name: string;
    artworkUrl: string;
    fields: unknown;
    isDefault?: boolean;
  }): Promise<CertificateTemplateDTO> {
    const artwork = this.resolveArtwork(input.artworkUrl);
    const fields = this.normalizeFields(input.fields) as unknown as Prisma.InputJsonValue;
    // First template ever becomes the default automatically — certificates
    // should start working the moment one template exists.
    const count = await this.prisma.certificateTemplate.count();
    const makeDefault = input.isDefault === true || count === 0;
    const row = await this.prisma.$transaction(async (tx) => {
      if (makeDefault) {
        await tx.certificateTemplate.updateMany({
          where: { isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.certificateTemplate.create({
        data: { name: input.name, ...artwork, fields, isDefault: makeDefault },
        include: this.withCount,
      });
    });
    return this.toDTO(row);
  }

  async update(
    id: string,
    input: { name?: string; artworkUrl?: string; fields?: unknown; isDefault?: boolean },
  ): Promise<CertificateTemplateDTO> {
    const existing = await this.prisma.certificateTemplate.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Template not found');
    const data: Prisma.CertificateTemplateUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.artworkUrl !== undefined) {
      const artwork = this.resolveArtwork(input.artworkUrl);
      data.artworkUrl = artwork.artworkUrl;
      data.imageWidth = artwork.imageWidth;
      data.imageHeight = artwork.imageHeight;
    }
    if (input.fields !== undefined) {
      data.fields = this.normalizeFields(input.fields) as unknown as Prisma.InputJsonValue;
    }
    const row = await this.prisma.$transaction(async (tx) => {
      if (input.isDefault === true && !existing.isDefault) {
        await tx.certificateTemplate.updateMany({
          where: { isDefault: true },
          data: { isDefault: false },
        });
        data.isDefault = true;
      }
      // isDefault:false is ignored — you demote a default by promoting another
      // template, so there's never a "no default while templates exist" state
      // unless the default itself is deleted.
      return tx.certificateTemplate.update({
        where: { id },
        data,
        include: this.withCount,
      });
    });
    return this.toDTO(row);
  }

  // Deleting is allowed even with issued certificates: Certificate.templateId
  // goes null (SetNull) and the snapshots + rendered PDFs stay intact.
  async remove(id: string): Promise<{ ok: true }> {
    const existing = await this.prisma.certificateTemplate.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Template not found');
    await this.prisma.certificateTemplate.delete({ where: { id } });
    return { ok: true };
  }
}
