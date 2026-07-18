import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtDownloadGuard } from '../auth/guards/jwt-download.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedPrincipal } from '../auth/jwt-payload.interface';
import {
  DOWNLOAD_TOKEN_TTL_SECONDS,
  certDownloadScope,
  type DownloadTokenPayload,
} from '../auth/download-token.util';
import { CertificatesService } from './certificates.service';
import { ClaimCertificateDto } from './dto/certificate.dto';

// Member claim/download + public verification + admin issued list. Template
// management lives in CertificateTemplatesController.
@Controller()
export class CertificatesController {
  constructor(
    private readonly certificates: CertificatesService,
    private readonly jwt: JwtService,
  ) {}

  // ----- Member -----

  @UseGuards(JwtAuthGuard)
  @Post('certificates/claim')
  claim(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: ClaimCertificateDto,
  ) {
    // Certificates belong to members; an admin token has no member identity.
    if (principal.isAdmin) throw new ForbiddenException('Members only');
    return this.certificates.claim(principal.sub, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('certificates/mine')
  mine(@CurrentUser() principal: AuthenticatedPrincipal) {
    if (principal.isAdmin) return [];
    return this.certificates.mine(principal.sub);
  }

  // Mint a short-lived, certificate-scoped download token (see the note-download
  // equivalent + download-token.util): authed via header, access-checked, and
  // returned as a bare token the client puts in the ?token= download URL so the
  // session JWT never lands in a URL.
  @UseGuards(JwtAuthGuard)
  @Get('certificates/:id/download-url')
  async downloadToken(
    @Param('id') id: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<{ token: string }> {
    // Throws if this principal can't download the certificate — same gate as
    // the download route.
    await this.certificates.getDownloadableFile(id, principal);
    const payload: DownloadTokenPayload = {
      sub: principal.sub,
      isAdmin: principal.isAdmin,
      typ: 'dl',
      scope: certDownloadScope(id),
    };
    const token = await this.jwt.signAsync(payload, {
      expiresIn: DOWNLOAD_TOKEN_TTL_SECONDS,
    });
    return { token };
  }

  // Owner (or admin) download. Token via Authorization header (web) OR a
  // short-lived download token in ?token= (mobile browser open).
  @UseGuards(JwtDownloadGuard)
  @Get('certificates/:id/download')
  async download(
    @Param('id') id: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Res() res: Response,
  ) {
    const { absPath, filename } = await this.certificates.getDownloadableFile(
      id,
      principal,
    );
    // The token can ride in ?token=; no-referrer stops it leaking via Referer.
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.download(absPath, filename);
  }

  // ----- Public -----

  // Serial verification (printed on every certificate). Always 200; unknown
  // serials return {valid:false} so the route leaks nothing beyond the serial.
  @Get('certificates/verify/:serial')
  verify(@Param('serial') serial: string) {
    return this.certificates.verify(serial);
  }

  // ----- Admin: issued certificates -----

  @UseGuards(PermissionsGuard)
  @RequirePermission('certificates', 'read')
  @Get('admin/certificates')
  adminList(
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.certificates.adminList(
      q,
      page ? Number(page) : 1,
      pageSize ? Number(pageSize) : 20,
    );
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('certificates', 'delete')
  @Delete('admin/certificates/:id')
  adminRemove(@Param('id') id: string) {
    return this.certificates.adminRemove(id);
  }
}
