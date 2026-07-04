import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Request } from 'express';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedPrincipal } from '../auth/jwt-payload.interface';
import { MediaService } from './media.service';
import { UpdateMediaDto } from './dto/media.dto';
import { MAX_MEDIA_BYTES } from './media.config';

// Absolute base for embeddable URLs: the configured public origin (prod) or the
// request host (dev). Mirrors the blog image-upload behavior.
function baseUrlOf(req: Request): string {
  return (
    process.env.PUBLIC_API_URL?.replace(/\/$/, '') ||
    `${req.protocol}://${req.get('host')}`
  );
}

@UseGuards(PermissionsGuard)
@Controller('admin/media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Get()
  @RequirePermission('gallery', 'read')
  list(
    @Req() req: Request,
    @Query('q') q?: string,
    @Query('kind') kind?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.media.list(baseUrlOf(req), {
      q,
      kind,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get(':id')
  @RequirePermission('gallery', 'read')
  get(@Req() req: Request, @Param('id') id: string) {
    return this.media.get(id, baseUrlOf(req));
  }

  // Upload ANY allowed file type. Held in memory so we can sanitize SVGs and
  // read image dimensions before handing the bytes to storage.
  @Post()
  @RequirePermission('gallery', 'create')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_MEDIA_BYTES },
    }),
  )
  upload(
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ) {
    return this.media.upload(file, baseUrlOf(req), principal.sub);
  }

  @Patch(':id')
  @RequirePermission('gallery', 'edit')
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateMediaDto,
  ) {
    return this.media.update(id, dto, baseUrlOf(req));
  }

  @Delete(':id')
  @RequirePermission('gallery', 'delete')
  remove(@Param('id') id: string) {
    return this.media.remove(id);
  }
}
