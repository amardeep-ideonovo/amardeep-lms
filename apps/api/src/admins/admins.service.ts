import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import type { AdminDTO, AdminPermissions } from '@lms/types';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAdminDto, UpdateAdminDto } from './dto/admins.dto';

const ADMIN_SELECT = {
  id: true,
  email: true,
  name: true,
  avatarUrl: true,
  role: true,
  permissions: true,
  createdAt: true,
} as const;

type AdminRow = Prisma.AdminGetPayload<{ select: typeof ADMIN_SELECT }>;

@Injectable()
export class AdminsService {
  constructor(private readonly prisma: PrismaService) {}

  private toDTO(a: AdminRow): AdminDTO {
    return {
      id: a.id,
      email: a.email,
      name: a.name ?? null,
      avatarUrl: a.avatarUrl ?? null,
      role: a.role,
      permissions: (a.permissions as AdminPermissions) ?? {},
      createdAt: a.createdAt.toISOString(),
    };
  }

  // Keep only the 4 known action booleans (set to true). Section keys pass
  // through unchecked so a NEWLY-added admin section works without editing this
  // file — the permission guard only ever reads specific (section, action)
  // pairs, so any stray section key is harmless. ADMIN_SECTIONS/ADMIN_ACTIONS in
  // @lms/types stay the source of truth for the UI + guards; we don't import the
  // runtime VALUES here because the API consumes @lms/types as types only.
  private sanitize(perms?: AdminPermissions): AdminPermissions {
    const actionKeys = ['create', 'read', 'edit', 'delete'] as const;
    const out: AdminPermissions = {};
    if (!perms || typeof perms !== 'object') return out;
    for (const section of Object.keys(perms)) {
      const actions = (perms as Record<string, unknown>)[section];
      if (!actions || typeof actions !== 'object') continue;
      const cleaned: Record<string, boolean> = {};
      for (const action of actionKeys) {
        if ((actions as Record<string, unknown>)[action] === true) {
          cleaned[action] = true;
        }
      }
      if (Object.keys(cleaned).length) {
        (out as Record<string, unknown>)[section] = cleaned;
      }
    }
    return out;
  }

  async list(): Promise<AdminDTO[]> {
    const admins = await this.prisma.admin.findMany({
      orderBy: { createdAt: 'asc' },
      select: ADMIN_SELECT,
    });
    return admins.map((a) => this.toDTO(a));
  }

  async create(dto: CreateAdminDto): Promise<AdminDTO> {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.admin.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('An admin with this email already exists');
    }
    const admin = await this.prisma.admin.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(dto.password, 10),
        role: dto.superAdmin ? 'SUPER_ADMIN' : 'ADMIN',
        permissions: (dto.superAdmin
          ? {}
          : this.sanitize(dto.permissions)) as unknown as Prisma.InputJsonValue,
      },
      select: ADMIN_SELECT,
    });
    return this.toDTO(admin);
  }

  async update(id: string, dto: UpdateAdminDto): Promise<AdminDTO> {
    const target = await this.prisma.admin.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Admin not found');

    const data: Prisma.AdminUpdateInput = {};
    if (dto.superAdmin !== undefined) {
      if (target.role === 'SUPER_ADMIN' && dto.superAdmin === false) {
        await this.assertNotLastSuperAdmin(id);
      }
      data.role = dto.superAdmin ? 'SUPER_ADMIN' : 'ADMIN';
    }
    if (dto.permissions !== undefined) {
      const willBeSuper = dto.superAdmin ?? target.role === 'SUPER_ADMIN';
      data.permissions = (willBeSuper
        ? {}
        : this.sanitize(dto.permissions)) as unknown as Prisma.InputJsonValue;
    }
    const updated = await this.prisma.admin.update({
      where: { id },
      data,
      select: ADMIN_SELECT,
    });
    return this.toDTO(updated);
  }

  async resetPassword(id: string, password: string): Promise<{ ok: true }> {
    const target = await this.prisma.admin.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!target) throw new NotFoundException('Admin not found');
    // Bump tokenVersion so the target admin's existing sessions are revoked —
    // a super-admin reset must lock the target out of any live session.
    await this.prisma.admin.update({
      where: { id },
      data: {
        passwordHash: await bcrypt.hash(password, 10),
        tokenVersion: { increment: 1 },
      },
    });
    return { ok: true };
  }

  async remove(actingAdminId: string, id: string): Promise<{ ok: true }> {
    if (id === actingAdminId) {
      throw new BadRequestException('You cannot delete your own account');
    }
    const target = await this.prisma.admin.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Admin not found');
    if (target.role === 'SUPER_ADMIN') {
      await this.assertNotLastSuperAdmin(id);
    }
    await this.prisma.admin.delete({ where: { id } });
    return { ok: true };
  }

  // Block removing/demoting the final super admin (lockout protection).
  private async assertNotLastSuperAdmin(excludingId: string): Promise<void> {
    const others = await this.prisma.admin.count({
      where: { role: 'SUPER_ADMIN', id: { not: excludingId } },
    });
    if (others === 0) {
      throw new BadRequestException('Cannot remove the last super admin');
    }
  }
}
