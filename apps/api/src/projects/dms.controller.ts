import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedPrincipal } from '../auth/jwt-payload.interface';
import { DmsService } from './dms.service';
import { OpenDmDto } from './dto/projects.dto';

// Direct messages (DMs) for Projects — admin-only, same guard stack + `projects`
// RBAC section as the channels controller. The acting admin id is read off the
// JWT principal (principal.sub); never client-supplied. A DM is a ChatChannel
// (kind=DM/GROUP_DM); all messaging reuses the existing channel endpoints.
@UseGuards(PermissionsGuard)
@Controller('admin/projects/dms')
export class DmsController {
  constructor(private readonly dms: DmsService) {}

  @Get()
  @RequirePermission('projects', 'read')
  list(@CurrentUser() principal: AuthenticatedPrincipal) {
    return this.dms.listDms(principal.sub);
  }

  @Post()
  @RequirePermission('projects', 'create')
  open(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: OpenDmDto,
  ) {
    return this.dms.openDm(principal.sub, dto.adminIds);
  }
}
