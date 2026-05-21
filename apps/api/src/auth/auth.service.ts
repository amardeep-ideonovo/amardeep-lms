import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import type {
  AuthAdmin,
  AuthUser,
  LoginResponse,
} from '@lms/types';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from './jwt-payload.interface';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async loginMember(
    email: string,
    password: string,
  ): Promise<LoginResponse<AuthUser>> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      username: user.username,
      isAdmin: false,
    };
    return {
      token: await this.jwt.signAsync(payload),
      user: { id: user.id, email: user.email, username: user.username },
    };
  }

  async loginAdmin(
    email: string,
    password: string,
  ): Promise<LoginResponse<AuthAdmin>> {
    const admin = await this.prisma.admin.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (!admin || !(await bcrypt.compare(password, admin.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const payload: JwtPayload = {
      sub: admin.id,
      email: admin.email,
      isAdmin: true,
      role: admin.role,
    };
    return {
      token: await this.jwt.signAsync(payload),
      user: { id: admin.id, email: admin.email, role: admin.role },
    };
  }

  /** Resolve the principal behind GET /auth/me from the JWT claims. */
  async me(principal: JwtPayload): Promise<AuthUser | AuthAdmin> {
    if (principal.isAdmin) {
      const admin = await this.prisma.admin.findUnique({
        where: { id: principal.sub },
      });
      if (!admin) throw new UnauthorizedException();
      return { id: admin.id, email: admin.email, role: admin.role };
    }
    const user = await this.prisma.user.findUnique({
      where: { id: principal.sub },
    });
    if (!user) throw new UnauthorizedException();
    return { id: user.id, email: user.email, username: user.username };
  }
}
