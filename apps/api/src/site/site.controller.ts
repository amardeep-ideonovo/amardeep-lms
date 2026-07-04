import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import type {
  FooterConfig,
  HeaderDTO,
  HeaderSummary,
  UpdateHeaderInput,
} from '@lms/types';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { SiteService } from './site.service';
import { FooterService } from './footer.service';
import {
  CreateHeaderDto,
  ReorderHeadersDto,
  UpdateFooterDto,
  UpdateHeaderDto,
} from './dto/site.dto';

// Headers live under the Navigation area, so they're gated by the existing
// `menus` permission (no new RBAC section). Static `headers/order` is declared
// before `headers/:id` so it isn't captured as an id.
@UseGuards(PermissionsGuard)
@Controller('admin/site')
export class SiteController {
  constructor(
    private readonly site: SiteService,
    private readonly footer: FooterService,
  ) {}

  @Get('headers')
  @RequirePermission('menus', 'read')
  list(): Promise<HeaderSummary[]> {
    return this.site.listHeaders();
  }

  @Post('headers')
  @RequirePermission('menus', 'create')
  create(@Body() dto: CreateHeaderDto): Promise<HeaderDTO> {
    return this.site.createHeader(dto.name);
  }

  @Put('headers/order')
  @RequirePermission('menus', 'edit')
  reorder(@Body() dto: ReorderHeadersDto): Promise<HeaderSummary[]> {
    return this.site.reorderHeaders(dto.ids);
  }

  @Get('headers/:id')
  @RequirePermission('menus', 'read')
  get(@Param('id') id: string): Promise<HeaderDTO> {
    return this.site.getHeader(id);
  }

  @Put('headers/:id')
  @RequirePermission('menus', 'edit')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateHeaderDto,
  ): Promise<HeaderDTO> {
    return this.site.updateHeader(id, dto as unknown as UpdateHeaderInput);
  }

  @Delete('headers/:id')
  @RequirePermission('menus', 'delete')
  remove(@Param('id') id: string): Promise<{ ok: true }> {
    return this.site.deleteHeader(id);
  }

  // ----- footer (single global config) -----
  @Get('footer')
  @RequirePermission('menus', 'read')
  getFooter(): Promise<FooterConfig> {
    return this.footer.read();
  }

  @Put('footer')
  @RequirePermission('menus', 'edit')
  putFooter(@Body() dto: UpdateFooterDto): Promise<FooterConfig> {
    return this.footer.write(dto.footer as unknown as FooterConfig);
  }
}
