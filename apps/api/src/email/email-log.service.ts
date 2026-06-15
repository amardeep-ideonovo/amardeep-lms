import { Injectable } from '@nestjs/common';
import type { EmailLog, EmailStatus, Prisma } from '@prisma/client';
import type { EmailLogDTO, EmailLogListDTO } from '@lms/types';
import { PrismaService } from '../prisma/prisma.service';

// Valid EmailLog statuses (mirrors the EmailStatus enum) — used to validate the
// optional ?status filter so a junk value is ignored rather than erroring.
const STATUSES: EmailStatus[] = [
  'QUEUED',
  'SENT',
  'FAILED',
  'BOUNCED',
  'COMPLAINED',
];

const MAX_PAGE_SIZE = 100;

// Read-only view over the EmailLog send ledger for the admin logs page.
// Paginated, newest-first, with an optional status filter and a free-text
// search over recipient + subject.
@Injectable()
export class EmailLogService {
  constructor(private readonly prisma: PrismaService) {}

  async list(params: {
    status?: string;
    q?: string;
    page?: number;
    pageSize?: number;
  }): Promise<EmailLogListDTO> {
    const page = Math.max(1, Math.floor(params.page ?? 1));
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Math.floor(params.pageSize ?? 50)),
    );

    const where: Prisma.EmailLogWhereInput = {};
    if (params.status && (STATUSES as string[]).includes(params.status)) {
      where.status = params.status as EmailStatus;
    }
    const q = params.q?.trim();
    if (q) {
      where.OR = [
        { to: { contains: q, mode: 'insensitive' } },
        { subject: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.emailLog.count({ where }),
      this.prisma.emailLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return { items: rows.map((r) => this.toDTO(r)), total, page, pageSize };
  }

  private toDTO(r: EmailLog): EmailLogDTO {
    return {
      id: r.id,
      to: r.to,
      subject: r.subject,
      status: r.status,
      templateKey: r.templateKey,
      campaignId: r.campaignId,
      providerId: r.providerId,
      error: r.error,
      sentAt: r.sentAt ? r.sentAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
