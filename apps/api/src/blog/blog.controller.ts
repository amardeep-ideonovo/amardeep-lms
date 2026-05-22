import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import type { Request } from 'express';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedPrincipal } from '../auth/jwt-payload.interface';
import { BlogService } from './blog.service';
import {
  CreatePostCategoryDto,
  CreatePostDto,
  UpdatePostDto,
} from './dto/blog.dto';
import {
  BLOG_POST_DIR,
  BLOG_POST_URL_PATH,
  ensureUploadDirs,
  imageExt,
} from './upload.config';

// Make sure the destination exists before multer's storage engine runs.
ensureUploadDirs();

// Disk storage: write to the blog-post dir with a unique, timestamp-based
// filename (as requested). Type is validated again via fileFilter below.
const blogImageStorage = diskStorage({
  destination: (_req, _file, cb) => cb(null, BLOG_POST_DIR),
  filename: (_req, file, cb) => {
    const ext = imageExt(file.mimetype, file.originalname);
    cb(null, `${Date.now()}${ext ?? '.img'}`);
  },
});

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

  @UseGuards(AdminGuard)
  @Delete('admin/blog/categories/:id')
  deleteCategory(@Param('id') id: string) {
    return this.blog.deleteCategory(id);
  }

  // Upload a featured image. Saved to <images>/blog-post/<timestamp>.<ext>
  // and served back via the /images static route. Returns an absolute URL
  // suitable for storing in a post's coverImageUrl.
  @UseGuards(AdminGuard)
  @Post('admin/blog/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: blogImageStorage,
      limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
      fileFilter: (_req, file, cb) => {
        cb(null, imageExt(file.mimetype, file.originalname) !== null);
      },
    }),
  )
  uploadImage(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BadRequestException(
        'No image file provided (allowed: jpg, png, webp, gif, avif; max 5 MB)',
      );
    }
    const base =
      process.env.PUBLIC_API_URL?.replace(/\/$/, '') ||
      `${req.protocol}://${req.get('host')}`;
    return {
      url: `${base}${BLOG_POST_URL_PATH}/${file.filename}`,
      filename: file.filename,
    };
  }
}
