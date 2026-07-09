import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { PopupsService } from './popups.service';
import {
  CreatePopupDto,
  PopupEventDto,
  UpdatePopupDto,
} from './dto/popup.dto';

// Popup routes. GET /popups/active is PUBLIC (no guard) and returns only ACTIVE
// popups filtered by context (a member-area surface / a CMS page). All
// management lives under /admin/* behind the `popups` permission.
@Controller()
export class PopupsController {
  constructor(private readonly popups: PopupsService) {}

  // ----- Public (no auth) -----

  // ?context=dashboard|classes|courses|lessons | ?context=page&pageId=<id>
  @Get('popups/active')
  listActive(
    @Query('context') context?: string,
    @Query('pageId') pageId?: string,
  ) {
    return this.popups.listActive(context, pageId);
  }

  // Fire-and-forget analytics ping from the renderer (view / click / dismiss).
  // Per-IP rate limit so the unauthenticated event route can't be used to forge
  // popup metrics in bulk.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('popups/:id/event')
  recordEvent(@Param('id') id: string, @Body() dto: PopupEventDto) {
    return this.popups.recordEvent(id, dto.type);
  }

  // ----- Admin: popup CRUD -----

  @UseGuards(PermissionsGuard)
  @RequirePermission('popups', 'read')
  @Get('admin/popups')
  adminList() {
    return this.popups.adminList();
  }

  // The editor loads the full document (including inactive) by id.
  @UseGuards(PermissionsGuard)
  @RequirePermission('popups', 'read')
  @Get('admin/popups/:id')
  adminGet(@Param('id') id: string) {
    return this.popups.adminGet(id);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('popups', 'create')
  @Post('admin/popups')
  adminCreate(@Body() dto: CreatePopupDto) {
    return this.popups.adminCreate(dto);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('popups', 'edit')
  @Patch('admin/popups/:id')
  adminUpdate(@Param('id') id: string, @Body() dto: UpdatePopupDto) {
    return this.popups.adminUpdate(id, dto);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('popups', 'delete')
  @Delete('admin/popups/:id')
  adminDelete(@Param('id') id: string) {
    return this.popups.adminDelete(id);
  }
}
