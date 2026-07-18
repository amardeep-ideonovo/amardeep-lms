import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  actorAdminId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

// Append-only audit trail for privileged admin actions. write() is best-effort:
// an audit failure must NEVER block or fail the underlying mutation, so it logs
// and swallows. Callers pass the acting admin + request IP (threaded from the
// controller) plus a stable action string + optional target/metadata.
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async write(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorAdminId: entry.actorAdminId ?? null,
          action: entry.action,
          targetType: entry.targetType ?? null,
          targetId: entry.targetId ?? null,
          metadata: (entry.metadata ?? {}) as object,
          ip: entry.ip ?? null,
        },
      });
    } catch (e) {
      this.logger.warn(
        `[audit] failed to record ${entry.action}: ${
          e instanceof Error ? e.message : e
        }`,
      );
    }
  }
}
