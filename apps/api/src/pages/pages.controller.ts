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
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedPrincipal } from '../auth/jwt-payload.interface';
import { PagesService } from './pages.service';
import { CreatePageDto, UpdatePageDto } from './dto/page.dto';
import {
  PAGE_IMAGE_DIR,
  PAGE_IMAGE_URL_PATH,
  ensurePageUploadDir,
  imageExt,
} from './upload.config';

// Make sure the destination exists before multer's storage engine runs.
ensurePageUploadDir();

// Disk storage: write to the page dir with a unique, timestamp-based filename.
// Type is validated again via fileFilter below.
const pageImageStorage = diskStorage({
  destination: (_req, _file, cb) => cb(null, PAGE_IMAGE_DIR),
  filename: (_req, file, cb) => {
    const ext = imageExt(file.mimetype, file.originalname);
    cb(null, `${Date.now()}${ext ?? '.img'}`);
  },
});

// Page routes mirror the blog: the /pages/* reads are PUBLIC (no guard) and
// return PUBLISHED pages only; all writes + draft visibility live under
// /admin/pages/* behind the `pages` permission.
@Controller()
export class PagesController {
  constructor(private readonly pages: PagesService) {}

  // ----- Public (no auth) -----

  @Get('pages')
  listPublished() {
    return this.pages.listPublished();
  }

  @Get('pages/:slug')
  getBySlug(@Param('slug') slug: string) {
    return this.pages.getPublishedBySlug(slug);
  }

  // ----- Admin -----

  @UseGuards(PermissionsGuard)
  @RequirePermission('pages', 'read')
  @Get('admin/pages')
  adminList() {
    return this.pages.adminList();
  }

  // The editor loads the full document (including drafts) by id.
  @UseGuards(PermissionsGuard)
  @RequirePermission('pages', 'read')
  @Get('admin/pages/:id')
  adminGet(@Param('id') id: string) {
    return this.pages.adminGet(id);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('pages', 'create')
  @Post('admin/pages')
  adminCreate(
    @Body() dto: CreatePageDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ) {
    return this.pages.adminCreate(dto, principal.sub);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('pages', 'edit')
  @Patch('admin/pages/:id')
  adminUpdate(@Param('id') id: string, @Body() dto: UpdatePageDto) {
    return this.pages.adminUpdate(id, dto);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('pages', 'delete')
  @Delete('admin/pages/:id')
  adminDelete(@Param('id') id: string) {
    return this.pages.adminDelete(id);
  }

  // Upload an image used inside a page. Saved to <images>/page/<timestamp>.<ext>
  // and served back via the /images static route. Returns an absolute URL.
  @UseGuards(PermissionsGuard)
  @RequirePermission('pages', 'edit')
  @Post('admin/pages/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: pageImageStorage,
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
      url: `${base}${PAGE_IMAGE_URL_PATH}/${file.filename}`,
      filename: file.filename,
    };
  }
}
