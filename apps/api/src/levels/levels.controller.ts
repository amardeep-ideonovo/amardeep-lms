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
import { AdminGuard } from '../auth/guards/admin.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedPrincipal } from '../auth/jwt-payload.interface';
import { LevelsService } from './levels.service';
import {
  CreateLevelCategoryDto,
  CreateLevelDto,
  UpdateLevelDto,
} from './dto/level.dto';

@Controller('levels')
export class LevelsController {
  constructor(private readonly levels: LevelsService) {}

  // Public: the checkout page resolves a level by slug or id and must work for
  // logged-out visitors — so this route has no guard.
  @Get('checkout/:slugOrId')
  checkout(@Param('slugOrId') slugOrId: string) {
    return this.levels.checkoutBySlugOrId(slugOrId);
  }

  // Listing is member-accessible (powers the subscribe/plan picker); writes are
  // admin-only. Member counts are only included for admins.
  @UseGuards(JwtAuthGuard)
  @Get()
  list(@CurrentUser() principal: AuthenticatedPrincipal) {
    return this.levels.list(principal.isAdmin);
  }

  // ----- Categories (admin-only grouping for classes) -----

  @UseGuards(AdminGuard)
  @Get('categories')
  listCategories() {
    return this.levels.listCategories();
  }

  @UseGuards(AdminGuard)
  @Post('categories')
  createCategory(@Body() dto: CreateLevelCategoryDto) {
    return this.levels.createCategory(dto);
  }

  @UseGuards(AdminGuard)
  @Delete('categories/:id')
  deleteCategory(@Param('id') id: string) {
    return this.levels.deleteCategory(id);
  }

  @UseGuards(AdminGuard)
  @Post()
  create(@Body() dto: CreateLevelDto) {
    return this.levels.create(dto);
  }

  @UseGuards(AdminGuard)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateLevelDto) {
    return this.levels.update(id, dto);
  }

  @UseGuards(AdminGuard)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.levels.remove(id);
  }
}
