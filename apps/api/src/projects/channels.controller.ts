import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedPrincipal } from '../auth/jwt-payload.interface';
import { ChannelsService } from './channels.service';
import { CreateChannelDto, UpdateChannelDto } from './dto/projects.dto';

// Internal team-chat channels. Admin-only — same guard stack as the Contacts /
// Settings controllers, gated on the `projects` section. The acting admin id is
// read off the JWT principal (principal.sub); never client-supplied.
@UseGuards(PermissionsGuard)
@Controller('admin/projects/channels')
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @Get()
  @RequirePermission('projects', 'read')
  list(@CurrentUser() principal: AuthenticatedPrincipal) {
    return this.channels.listChannels(principal.sub);
  }

  @Post()
  @RequirePermission('projects', 'create')
  create(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: CreateChannelDto,
  ) {
    return this.channels.createChannel(principal.sub, dto);
  }

  @Get(':id')
  @RequirePermission('projects', 'read')
  detail(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
  ) {
    return this.channels.getChannelDetail(principal.sub, id);
  }

  @Patch(':id')
  @RequirePermission('projects', 'edit')
  update(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body() dto: UpdateChannelDto,
  ) {
    return this.channels.updateChannel(principal.sub, id, dto);
  }

  @Post(':id/join')
  @RequirePermission('projects', 'edit')
  join(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
  ) {
    return this.channels.join(principal.sub, id);
  }

  @Post(':id/leave')
  @RequirePermission('projects', 'edit')
  leave(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
  ) {
    return this.channels.leave(principal.sub, id);
  }
}
