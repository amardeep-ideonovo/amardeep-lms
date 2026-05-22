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
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedPrincipal } from '../auth/jwt-payload.interface';
import { BlogService } from './blog.service';
import {
  CreatePostCategoryDto,
  CreatePostDto,
  UpdatePostDto,
} from './dto/blog.dto';

// Blog routes. The /blog/* reads are PUBLIC (no guard) — this is the only
// unauthenticated surface in the API, and it returns PUBLISHED posts only.
// All writes + draft visibility live under /admin/blog/* behind AdminGuard.
@Controller()
export class BlogController {
  constructor(private readonly blog: BlogService) {}

  // ----- Public (no auth) -----

  @Get('blog/posts')
  listPublished() {
    return this.blog.listPublished();
  }

  @Get('blog/categories')
  listCategories() {
    return this.blog.listCategories();
  }

  @Get('blog/posts/:slug')
  getBySlug(@Param('slug') slug: string) {
    return this.blog.getPublishedBySlug(slug);
  }

  // ----- Admin -----

  @UseGuards(AdminGuard)
  @Get('admin/blog/posts')
  adminList() {
    return this.blog.adminList();
  }

  @UseGuards(AdminGuard)
  @Post('admin/blog/posts')
  adminCreate(
    @Body() dto: CreatePostDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ) {
    return this.blog.adminCreate(dto, principal.sub);
  }

  @UseGuards(AdminGuard)
  @Patch('admin/blog/posts/:id')
  adminUpdate(@Param('id') id: string, @Body() dto: UpdatePostDto) {
    return this.blog.adminUpdate(id, dto);
  }

  @UseGuards(AdminGuard)
  @Delete('admin/blog/posts/:id')
  adminDelete(@Param('id') id: string) {
    return this.blog.adminDelete(id);
  }

  @UseGuards(AdminGuard)
  @Post('admin/blog/categories')
  createCategory(@Body() dto: CreatePostCategoryDto) {
    return this.blog.createCategory(dto);
  }
}
