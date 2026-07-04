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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtDownloadGuard } from '../auth/guards/jwt-download.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedPrincipal } from '../auth/jwt-payload.interface';
import { CertificatesService } from './certificates.service';
import { ClaimCertificateDto } from './dto/certificate.dto';

// Member claim/download + public verification + admin issued list. Template
// management lives in CertificateTemplatesController.
@Controller()
export class CertificatesController {
  constructor(private readonly certificates: CertificatesService) {}

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

  // Owner (or admin) download. Token via Authorization header OR ?token= so a
  // mobile browser open works — same contract as lesson-note downloads.
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
