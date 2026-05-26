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
import { AdminGuard } from '../auth/guards/admin.guard';
import { PopupsService } from './popups.service';
import {
  CreatePopupDto,
  PopupEventDto,
  UpdatePopupDto,
} from './dto/popup.dto';

// Popup routes. GET /popups/active is PUBLIC (no guard) and returns only ACTIVE
// popups filtered by context (dashboard / a CMS page). All management lives
// under /admin/* behind AdminGuard.
@Controller()
export class PopupsController {
  constructor(private readonly popups: PopupsService) {}

  // ----- Public (no auth) -----

  // ?context=dashboard | ?context=page&pageId=<id>
  @Get('popups/active')
  listActive(
    @Query('context') context?: string,
    @Query('pageId') pageId?: string,
  ) {
    return this.popups.listActive(context, pageId);
  }

  // Fire-and-forget analytics ping from the renderer (view / click / dismiss).
  @Post('popups/:id/event')
  recordEvent(@Param('id') id: string, @Body() dto: PopupEventDto) {
    return this.popups.recordEvent(id, dto.type);
  }

  // ----- Admin: popup CRUD -----

  @UseGuards(AdminGuard)
  @Get('admin/popups')
  adminList() {
    return this.popups.adminList();
  }

  // The editor loads the full document (including inactive) by id.
  @UseGuards(AdminGuard)
  @Get('admin/popups/:id')
  adminGet(@Param('id') id: string) {
    return this.popups.adminGet(id);
  }

  @UseGuards(AdminGuard)
  @Post('admin/popups')
  adminCreate(@Body() dto: CreatePopupDto) {
    return this.popups.adminCreate(dto);
  }

  @UseGuards(AdminGuard)
  @Patch('admin/popups/:id')
  adminUpdate(@Param('id') id: string, @Body() dto: UpdatePopupDto) {
    return this.popups.adminUpdate(id, dto);
  }

  @UseGuards(AdminGuard)
  @Delete('admin/popups/:id')
  adminDelete(@Param('id') id: string) {
    return this.popups.adminDelete(id);
  }
}
