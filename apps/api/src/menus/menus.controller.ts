import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { MenusService } from './menus.service';
import {
  CreateMenuDto,
  CreateMenuItemDto,
  ReorderMenuItemsDto,
  UpdateMenuDto,
  UpdateMenuItemDto,
} from './dto/menus.dto';

// Admin CRUD for navigation menus (RBAC `menus` section). The static `items/...`
// routes have 2 segments and never collide with the 1-segment `:id` routes.
@UseGuards(PermissionsGuard)
@Controller('admin/menus')
export class MenusController {
  constructor(private readonly menus: MenusService) {}

  @Get()
  @RequirePermission('menus', 'read')
  list() {
    return this.menus.list();
  }

  @Post()
  @RequirePermission('menus', 'create')
  create(@Body() dto: CreateMenuDto) {
    return this.menus.create(dto);
  }

  @Patch('items/:itemId')
  @RequirePermission('menus', 'edit')
  updateItem(@Param('itemId') itemId: string, @Body() dto: UpdateMenuItemDto) {
    return this.menus.updateItem(itemId, dto);
  }

  @Delete('items/:itemId')
  @RequirePermission('menus', 'edit')
  deleteItem(@Param('itemId') itemId: string) {
    return this.menus.deleteItem(itemId);
  }

  @Get(':id')
  @RequirePermission('menus', 'read')
  get(@Param('id') id: string) {
    return this.menus.get(id);
  }

  @Patch(':id')
  @RequirePermission('menus', 'edit')
  update(@Param('id') id: string, @Body() dto: UpdateMenuDto) {
    return this.menus.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('menus', 'delete')
  remove(@Param('id') id: string) {
    return this.menus.remove(id);
  }

  @Post(':id/items')
  @RequirePermission('menus', 'edit')
  addItem(@Param('id') id: string, @Body() dto: CreateMenuItemDto) {
    return this.menus.addItem(id, dto);
  }

  @Put(':id/order')
  @RequirePermission('menus', 'edit')
  reorder(@Param('id') id: string, @Body() dto: ReorderMenuItemsDto) {
    return this.menus.reorder(id, dto);
  }
}
