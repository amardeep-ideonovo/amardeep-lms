import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  Audience,
  AudienceField,
  Contact,
  Segment,
} from '@prisma/client';
import type {
  AudienceDTO,
  AudienceFieldDTO,
  ContactDTO,
  ContactFilter,
  ContactListDTO,
  ContactSource,
  ContactStatus,
  CreateAudienceInput,
  CreateContactInput,
  CreateSegmentInput,
  SegmentDTO,
  UpdateAudienceInput,
  UpdateContactInput,
  UpdateSegmentInput,
  UpsertAudienceFieldInput,
} from '@lms/types';
import { PrismaService } from '../prisma/prisma.service';

// Admin-facing CRUD for the in-house list system (Audiences / Fields / Contacts
// / Segments). Kept separate from the parity ContactsService so the dual-write
// call-sites stay focused; both live in the (global) ContactsModule.
@Injectable()
export class ContactsAdminService {
  constructor(private readonly prisma: PrismaService) {}

  private norm(email: string): string {
    return email.trim().toLowerCase();
  }

  // Slugify a user-supplied slug (or null to clear it). Empty -> null.
  private slugify(input?: string | null): string | null {
    if (input == null) return null;
    const s = input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return s || null;
  }

  // ───────────────────────── mappers ─────────────────────────

  private toAudienceDTO(
    a: Audience,
    counts: { contactCount: number; subscribedCount: number },
  ): AudienceDTO {
    return {
      id: a.id,
      name: a.name,
      slug: a.slug,
      isDefault: a.isDefault,
      contactCount: counts.contactCount,
      subscribedCount: counts.subscribedCount,
      createdAt: a.createdAt.toISOString(),
    };
  }

  private toFieldDTO(f: AudienceField): AudienceFieldDTO {
    return {
      tag: f.tag,
      label: f.label,
      type: f.type,
      required: f.required,
    };
  }

  private toContactDTO(c: Contact): ContactDTO {
    return {
      id: c.id,
      audienceId: c.audienceId,
      email: c.email,
      status: c.status as ContactStatus,
      firstName: c.firstName,
      lastName: c.lastName,
      attributes: (c.attributes ?? {}) as Record<string, unknown>,
      tags: c.tags,
      source: c.source as ContactSource,
      userId: c.userId,
      createdAt: c.createdAt.toISOString(),
    };
  }

  private toSegmentDTO(s: Segment, contactCount?: number): SegmentDTO {
    return {
      id: s.id,
      audienceId: s.audienceId,
      name: s.name,
      filter: (s.filter ?? {}) as ContactFilter,
      ...(contactCount === undefined ? {} : { contactCount }),
      createdAt: s.createdAt.toISOString(),
    };
  }

  // ───────────────────────── Audiences ─────────────────────────

  async listAudiences(): Promise<AudienceDTO[]> {
    const audiences = await this.prisma.audience.findMany({
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    if (audiences.length === 0) return [];

    // Total contacts per audience, plus the SUBSCRIBED subset, in two grouped
    // queries (cheaper than N counts).
    const ids = audiences.map((a) => a.id);
    const [totals, subscribed] = await Promise.all([
      this.prisma.contact.groupBy({
        by: ['audienceId'],
        where: { audienceId: { in: ids } },
        _count: { _all: true },
      }),
      this.prisma.contact.groupBy({
        by: ['audienceId'],
        where: { audienceId: { in: ids }, status: 'SUBSCRIBED' },
        _count: { _all: true },
      }),
    ]);
    const totalBy = new Map(totals.map((t) => [t.audienceId, t._count._all]));
    const subBy = new Map(
      subscribed.map((t) => [t.audienceId, t._count._all]),
    );

    return audiences.map((a) =>
      this.toAudienceDTO(a, {
        contactCount: totalBy.get(a.id) ?? 0,
        subscribedCount: subBy.get(a.id) ?? 0,
      }),
    );
  }

  async getAudience(id: string): Promise<AudienceDTO> {
    const a = await this.prisma.audience.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Audience not found');
    const [contactCount, subscribedCount] = await Promise.all([
      this.prisma.contact.count({ where: { audienceId: id } }),
      this.prisma.contact.count({
        where: { audienceId: id, status: 'SUBSCRIBED' },
      }),
    ]);
    return this.toAudienceDTO(a, { contactCount, subscribedCount });
  }

  async createAudience(input: CreateAudienceInput): Promise<AudienceDTO> {
    const slug = this.slugify(input.slug);
    // Setting a new default unsets any existing default (single-default invariant).
    const created = await this.prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.audience.updateMany({
          where: { isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.audience.create({
        data: {
          name: input.name.trim(),
          slug,
          isDefault: input.isDefault ?? false,
        },
      });
    });
    return this.toAudienceDTO(created, {
      contactCount: 0,
      subscribedCount: 0,
    });
  }

  async updateAudience(
    id: string,
    input: UpdateAudienceInput,
  ): Promise<AudienceDTO> {
    const existing = await this.prisma.audience.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Audience not found');

    const data: Prisma.AudienceUpdateInput = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.slug !== undefined) data.slug = this.slugify(input.slug);
    if (input.isDefault !== undefined) data.isDefault = input.isDefault;

    await this.prisma.$transaction(async (tx) => {
      // Promoting this audience to default clears the flag on all others first.
      if (input.isDefault === true) {
        await tx.audience.updateMany({
          where: { isDefault: true, NOT: { id } },
          data: { isDefault: false },
        });
      }
      await tx.audience.update({ where: { id }, data });
    });
    return this.getAudience(id);
  }

  async deleteAudience(id: string): Promise<{ ok: true }> {
    const existing = await this.prisma.audience.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Audience not found');
    // Contacts/fields/segments cascade via the schema's onDelete: Cascade.
    await this.prisma.audience.delete({ where: { id } });
    return { ok: true };
  }

  // ───────────────────────── Fields ─────────────────────────

  private async assertAudience(audienceId: string): Promise<void> {
    const a = await this.prisma.audience.findUnique({
      where: { id: audienceId },
      select: { id: true },
    });
    if (!a) throw new NotFoundException('Audience not found');
  }

  async listFields(audienceId: string): Promise<AudienceFieldDTO[]> {
    await this.assertAudience(audienceId);
    const fields = await this.prisma.audienceField.findMany({
      where: { audienceId },
      orderBy: { tag: 'asc' },
    });
    return fields.map((f) => this.toFieldDTO(f));
  }

  async upsertField(
    audienceId: string,
    input: UpsertAudienceFieldInput,
  ): Promise<AudienceFieldDTO> {
    await this.assertAudience(audienceId);
    const tag = input.tag.trim().toUpperCase();
    if (!tag) throw new BadRequestException('Tag is required');
    const field = await this.prisma.audienceField.upsert({
      where: { audienceId_tag: { audienceId, tag } },
      create: {
        audienceId,
        tag,
        label: input.label.trim(),
        type: input.type?.trim() || 'text',
        required: input.required ?? false,
      },
      update: {
        label: input.label.trim(),
        ...(input.type !== undefined ? { type: input.type.trim() || 'text' } : {}),
        ...(input.required !== undefined ? { required: input.required } : {}),
      },
    });
    return this.toFieldDTO(field);
  }

  async deleteField(audienceId: string, tag: string): Promise<{ ok: true }> {
    await this.assertAudience(audienceId);
    const upper = tag.trim().toUpperCase();
    try {
      await this.prisma.audienceField.delete({
        where: { audienceId_tag: { audienceId, tag: upper } },
      });
    } catch {
      throw new NotFoundException('Field not found');
    }
    return { ok: true };
  }

  // ───────────────────────── Contacts ─────────────────────────

  async listContacts(
    audienceId: string,
    opts: {
      status?: ContactStatus;
      tag?: string;
      q?: string;
      page?: number;
      pageSize?: number;
    },
  ): Promise<ContactListDTO> {
    await this.assertAudience(audienceId);
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 50));

    const where: Prisma.ContactWhereInput = { audienceId };
    if (opts.status) where.status = opts.status;
    if (opts.tag) where.tags = { has: opts.tag };
    const q = opts.q?.trim();
    if (q) {
      where.OR = [
        { email: { contains: q, mode: 'insensitive' } },
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [total, rows] = await Promise.all([
      this.prisma.contact.count({ where }),
      this.prisma.contact.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      items: rows.map((c) => this.toContactDTO(c)),
      total,
      page,
      pageSize,
    };
  }

  async createContact(
    audienceId: string,
    input: CreateContactInput,
  ): Promise<ContactDTO> {
    await this.assertAudience(audienceId);
    const email = this.norm(input.email);
    if (!email) throw new BadRequestException('Email is required');

    const clash = await this.prisma.contact.findUnique({
      where: { audienceId_email: { audienceId, email } },
      select: { id: true },
    });
    if (clash) {
      throw new BadRequestException(
        'A contact with this email already exists in this audience',
      );
    }

    const status = (input.status ?? 'SUBSCRIBED') as ContactStatus;
    const created = await this.prisma.contact.create({
      data: {
        audienceId,
        email,
        status,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
        attributes: (input.attributes ?? {}) as Prisma.InputJsonValue,
        tags: input.tags ?? [],
        source: (input.source ?? 'ADMIN') as ContactSource,
        confirmedAt: status === 'SUBSCRIBED' ? new Date() : null,
        unsubscribedAt: status === 'UNSUBSCRIBED' ? new Date() : null,
      },
    });
    return this.toContactDTO(created);
  }

  async updateContact(
    id: string,
    input: UpdateContactInput,
  ): Promise<ContactDTO> {
    const existing = await this.prisma.contact.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Contact not found');

    const data: Prisma.ContactUpdateInput = {};
    if (input.email !== undefined) {
      const email = this.norm(input.email);
      if (!email) throw new BadRequestException('Email is required');
      if (email !== existing.email) {
        const clash = await this.prisma.contact.findUnique({
          where: {
            audienceId_email: { audienceId: existing.audienceId, email },
          },
          select: { id: true },
        });
        if (clash) {
          throw new BadRequestException(
            'Another contact in this audience already uses that email',
          );
        }
      }
      data.email = email;
    }
    if (input.firstName !== undefined) data.firstName = input.firstName;
    if (input.lastName !== undefined) data.lastName = input.lastName;
    if (input.attributes !== undefined) {
      data.attributes = input.attributes as Prisma.InputJsonValue;
    }
    if (input.tags !== undefined) data.tags = input.tags;
    if (input.status !== undefined) {
      data.status = input.status;
      // Keep the timestamp columns coherent with the new status.
      if (input.status === 'SUBSCRIBED' && !existing.confirmedAt) {
        data.confirmedAt = new Date();
      }
      if (input.status === 'UNSUBSCRIBED') {
        data.unsubscribedAt = new Date();
      }
    }

    const updated = await this.prisma.contact.update({ where: { id }, data });
    return this.toContactDTO(updated);
  }

  async deleteContact(id: string): Promise<{ ok: true }> {
    const existing = await this.prisma.contact.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Contact not found');
    await this.prisma.contact.delete({ where: { id } });
    return { ok: true };
  }

  // ───────────────────────── Segments ─────────────────────────

  // Translate a saved ContactFilter into a Prisma where-clause (used to resolve
  // a segment's live size).
  private filterToWhere(
    audienceId: string,
    filter: ContactFilter,
  ): Prisma.ContactWhereInput {
    const where: Prisma.ContactWhereInput = { audienceId };
    if (filter.status) where.status = filter.status;
    if (filter.anyTags?.length) where.tags = { hasSome: filter.anyTags };
    if (filter.allTags?.length) {
      // allTags combines with anyTags via AND on the same `tags` column.
      where.AND = [{ tags: { hasEvery: filter.allTags } }];
    }
    const search = filter.search?.trim();
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  // Normalize an incoming filter to just the known keys (drops noise).
  private cleanFilter(filter: ContactFilter): ContactFilter {
    const out: ContactFilter = {};
    if (filter.status) out.status = filter.status;
    if (Array.isArray(filter.anyTags) && filter.anyTags.length) {
      out.anyTags = filter.anyTags.filter(Boolean);
    }
    if (Array.isArray(filter.allTags) && filter.allTags.length) {
      out.allTags = filter.allTags.filter(Boolean);
    }
    if (typeof filter.search === 'string' && filter.search.trim()) {
      out.search = filter.search.trim();
    }
    return out;
  }

  async listSegments(audienceId: string): Promise<SegmentDTO[]> {
    await this.assertAudience(audienceId);
    const segments = await this.prisma.segment.findMany({
      where: { audienceId },
      orderBy: { createdAt: 'asc' },
    });
    // Resolve each segment's live size so the admin list can show counts.
    return Promise.all(
      segments.map(async (s) => {
        const count = await this.prisma.contact.count({
          where: this.filterToWhere(audienceId, (s.filter ?? {}) as ContactFilter),
        });
        return this.toSegmentDTO(s, count);
      }),
    );
  }

  async createSegment(
    audienceId: string,
    input: CreateSegmentInput,
  ): Promise<SegmentDTO> {
    await this.assertAudience(audienceId);
    const filter = this.cleanFilter(input.filter ?? {});
    const created = await this.prisma.segment.create({
      data: {
        audienceId,
        name: input.name.trim(),
        filter: filter as Prisma.InputJsonValue,
      },
    });
    const count = await this.prisma.contact.count({
      where: this.filterToWhere(audienceId, filter),
    });
    return this.toSegmentDTO(created, count);
  }

  async updateSegment(
    id: string,
    input: UpdateSegmentInput,
  ): Promise<SegmentDTO> {
    const existing = await this.prisma.segment.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Segment not found');

    const data: Prisma.SegmentUpdateInput = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.filter !== undefined) {
      data.filter = this.cleanFilter(input.filter) as Prisma.InputJsonValue;
    }
    const updated = await this.prisma.segment.update({ where: { id }, data });
    const count = await this.prisma.contact.count({
      where: this.filterToWhere(
        updated.audienceId,
        (updated.filter ?? {}) as ContactFilter,
      ),
    });
    return this.toSegmentDTO(updated, count);
  }

  async deleteSegment(id: string): Promise<{ ok: true }> {
    const existing = await this.prisma.segment.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Segment not found');
    await this.prisma.segment.delete({ where: { id } });
    return { ok: true };
  }
}
