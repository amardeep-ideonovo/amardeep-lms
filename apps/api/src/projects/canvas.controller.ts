import {
  Body,
  Controller,
  Delete,
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
import { CanvasService } from './canvas.service';
import { CreateCanvasDto, UpdateCanvasDto } from './dto/projects.dto';

// Canvas docs: rich-text channel tabs (the "Web SOP" tab). Admin-only behind the
// `projects` permission. Routes span two base paths (channel-scoped list/create
// vs. canvas-scoped update/delete), so no shared prefix — full paths each.
@UseGuards(PermissionsGuard)
@Controller()
export class CanvasController {
  constructor(private readonly canvas: CanvasService) {}

  @Get('admin/projects/channels/:id/canvases')
  @RequirePermission('projects', 'read')
  list(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
  ) {
    return this.canvas.listCanvases(principal.sub, id);
  }

  @Post('admin/projects/channels/:id/canvases')
  @RequirePermission('projects', 'create')
  create(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body() dto: CreateCanvasDto,
  ) {
    return this.canvas.createCanvas(principal.sub, id, dto);
  }

  @Patch('admin/projects/canvases/:cid')
  @RequirePermission('projects', 'edit')
  update(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('cid') cid: string,
    @Body() dto: UpdateCanvasDto,
  ) {
    return this.canvas.updateCanvas(principal.sub, cid, dto);
  }

  @Delete('admin/projects/canvases/:cid')
  @RequirePermission('projects', 'delete')
  delete(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('cid') cid: string,
  ) {
    return this.canvas.deleteCanvas(principal.sub, cid);
  }
}
