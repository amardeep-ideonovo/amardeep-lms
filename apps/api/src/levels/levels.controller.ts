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

  // Public: full class landing-page data (MasterClass-style); works logged-out.
  @Get('page/:slugOrId')
  classPage(@Param('slugOrId') slugOrId: string) {
    return this.levels.classPageBySlugOrId(slugOrId);
  }

  // Public: minimal class list (sitemap + cross-linking).
  @Get('public')
  listPublic() {
    return this.levels.listPublicClasses();
  }

  // Member: published class tiles for the dashboard (owned flag per class).
  @UseGuards(JwtAuthGuard)
  @Get('my-classes')
  myClasses(@CurrentUser() principal: AuthenticatedPrincipal) {
    return this.levels.myClasses(principal.sub);
  }

  // Member: a class's courses — only returned when the member owns the class.
  @UseGuards(JwtAuthGuard)
  @Get(':slugOrId/my-courses')
  myClassCourses(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('slugOrId') slugOrId: string,
  ) {
    return this.levels.myClassCourses(principal.sub, slugOrId);
  }

  // Listing is member-accessible (powers the subscribe/plan picker); writes are
  // admin-only. Member counts are only included for admins.
  @UseGuards(JwtAuthGuard)
  @Get()
  list(@CurrentUser() principal: AuthenticatedPrincipal) {
    return this.levels.list(principal.isAdmin);
  }

  // ----- Categories (admin-only grouping for classes) -----

  @UseGuards(PermissionsGuard)
  @RequirePermission('classes', 'read')
  @Get('categories')
  listCategories() {
    return this.levels.listCategories();
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('classes', 'create')
  @Post('categories')
  createCategory(@Body() dto: CreateLevelCategoryDto) {
    return this.levels.createCategory(dto);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('classes', 'delete')
  @Delete('categories/:id')
  deleteCategory(@Param('id') id: string) {
    return this.levels.deleteCategory(id);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('classes', 'create')
  @Post()
  create(@Body() dto: CreateLevelDto) {
    return this.levels.create(dto);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('classes', 'edit')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateLevelDto) {
    return this.levels.update(id, dto);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('classes', 'delete')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.levels.remove(id);
  }

  // Soft-archive: a reversible 'edit' state change (hides the class from members
  // but keeps grants/subs/certs), unlike the destructive 'delete' above.
  @UseGuards(PermissionsGuard)
  @RequirePermission('classes', 'edit')
  @Patch(':id/archive')
  archive(@Param('id') id: string) {
    return this.levels.archive(id);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('classes', 'edit')
  @Patch(':id/unarchive')
  unarchive(@Param('id') id: string) {
    return this.levels.unarchive(id);
  }
}
