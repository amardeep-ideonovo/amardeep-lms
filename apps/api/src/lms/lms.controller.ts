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
  Res,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { JwtDownloadGuard } from '../auth/guards/jwt-download.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedPrincipal } from '../auth/jwt-payload.interface';
import { LmsService } from './lms.service';
import {
  CreateCourseDto,
  CreateLessonDto,
  UpdateCourseDto,
  UpdateLessonDto,
  UpdateLessonNoteDto,
} from './dto/lms.dto';
import {
  COURSE_IMG_DIR,
  COURSE_IMG_URL_PATH,
  LESSON_IMG_DIR,
  LESSON_IMG_URL_PATH,
  LESSON_NOTES_DIR,
  MAX_IMAGE_BYTES,
  MAX_NOTE_BYTES,
  MAX_NOTES_PER_UPLOAD,
  ensureLmsUploadDirs,
  imageExt,
  noteFileExt,
  timestampName,
} from './upload.config';

// Make sure the destinations exist before multer's storage engine runs.
ensureLmsUploadDirs();

// Disk storage engines: unique timestamp-based filenames; type is validated
// again per route via fileFilter. Images land in the public /images tree;
// note files land in the PRIVATE files tree (streamed only via /download).
const courseImageStorage = diskStorage({
  destination: (_req, _file, cb) => cb(null, COURSE_IMG_DIR),
  filename: (_req, file, cb) =>
    cb(
      null,
      timestampName(imageExt(file.mimetype, file.originalname) ?? '.img'),
    ),
});
const lessonImageStorage = diskStorage({
  destination: (_req, _file, cb) => cb(null, LESSON_IMG_DIR),
  filename: (_req, file, cb) =>
    cb(
      null,
      timestampName(imageExt(file.mimetype, file.originalname) ?? '.img'),
    ),
});
const noteStorage = diskStorage({
  destination: (_req, _file, cb) => cb(null, LESSON_NOTES_DIR),
  filename: (_req, file, cb) =>
    cb(
      null,
      timestampName(noteFileExt(file.mimetype, file.originalname) ?? '.bin'),
    ),
});
// Absolute base for built URLs: PUBLIC_API_URL in prod, else the request host.
function publicBase(req: Request): string {
  return (
    process.env.PUBLIC_API_URL?.replace(/\/$/, '') ||
    `${req.protocol}://${req.get('host')}`
  );
}

// LMS routes. Reads are member-authenticated (and access-aware); writes are
// gated by the `courses` permission. `userId` is omitted for admins so they see
// everything unlocked.
@Controller()
export class LmsController {
  constructor(private readonly lms: LmsService) {}

  private memberContext(principal: AuthenticatedPrincipal): string | undefined {
    return principal.isAdmin ? undefined : principal.sub;
  }

  // ----- Courses -----

  @UseGuards(JwtAuthGuard)
  @Get('courses')
  listCourses(@CurrentUser() principal: AuthenticatedPrincipal) {
    return this.lms.listCourses(this.memberContext(principal));
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('courses', 'create')
  @Post('courses')
  createCourse(@Body() dto: CreateCourseDto) {
    return this.lms.createCourse(dto);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('courses', 'edit')
  @Patch('courses/:id')
  updateCourse(@Param('id') id: string, @Body() dto: UpdateCourseDto) {
    return this.lms.updateCourse(id, dto);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('courses', 'delete')
  @Delete('courses/:id')
  deleteCourse(@Param('id') id: string) {
    return this.lms.deleteCourse(id);
  }

  // Upload a course image (thumbnail or cover). Saved under the public
  // /images/course tree; returns an absolute URL to store on the course.
  @UseGuards(PermissionsGuard)
  @RequirePermission('courses', 'create')
  @Post('courses/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: courseImageStorage,
      limits: { fileSize: MAX_IMAGE_BYTES },
      fileFilter: (_req, file, cb) =>
        cb(null, imageExt(file.mimetype, file.originalname) !== null),
    }),
  )
  uploadCourseImage(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BadRequestException(
        'No image file (allowed: jpg, png, webp, gif, avif; max 5 MB)',
      );
    }
    return {
      url: `${publicBase(req)}${COURSE_IMG_URL_PATH}/${file.filename}`,
      filename: file.filename,
    };
  }

  // ----- Lessons -----

  @UseGuards(JwtAuthGuard)
  @Get('courses/:id/lessons')
  listCourseLessons(
    @Param('id') id: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ) {
    return this.lms.listCourseLessons(id, this.memberContext(principal));
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('courses', 'create')
  @Post('courses/:id/lessons')
  createLesson(@Param('id') id: string, @Body() dto: CreateLessonDto) {
    return this.lms.createLesson(id, dto);
  }

  // Upload a lesson thumbnail. Saved under the public /images/lesson tree.
  @UseGuards(PermissionsGuard)
  @RequirePermission('courses', 'create')
  @Post('lessons/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: lessonImageStorage,
      limits: { fileSize: MAX_IMAGE_BYTES },
      fileFilter: (_req, file, cb) =>
        cb(null, imageExt(file.mimetype, file.originalname) !== null),
    }),
  )
  uploadLessonImage(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BadRequestException(
        'No image file (allowed: jpg, png, webp, gif, avif; max 5 MB)',
      );
    }
    return {
      url: `${publicBase(req)}${LESSON_IMG_URL_PATH}/${file.filename}`,
      filename: file.filename,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('lessons/:id')
  getLesson(
    @Param('id') id: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ) {
    return this.lms.getLesson(id, principal.sub);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('courses', 'edit')
  @Patch('lessons/:id')
  updateLesson(@Param('id') id: string, @Body() dto: UpdateLessonDto) {
    return this.lms.updateLesson(id, dto);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('courses', 'delete')
  @Delete('lessons/:id')
  deleteLesson(@Param('id') id: string) {
    return this.lms.deleteLesson(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('lessons/:id/complete')
  completeLesson(
    @Param('id') id: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ) {
    return this.lms.completeLesson(id, principal.sub);
  }

  // ----- Lesson notes (downloadable attachments) -----

  @UseGuards(PermissionsGuard)
  @RequirePermission('courses', 'create')
  @Post('lessons/:id/notes')
  @UseInterceptors(
    FilesInterceptor('files', MAX_NOTES_PER_UPLOAD, {
      storage: noteStorage,
      limits: { fileSize: MAX_NOTE_BYTES },
      fileFilter: (_req, file, cb) =>
        cb(null, noteFileExt(file.mimetype, file.originalname) !== null),
    }),
  )
  uploadNotes(
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
  ) {
    return this.lms.addNotes(id, files ?? []);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('courses', 'edit')
  @Patch('lessons/:id/notes/:noteId')
  renameNote(
    @Param('id') id: string,
    @Param('noteId') noteId: string,
    @Body() dto: UpdateLessonNoteDto,
  ) {
    return this.lms.renameNote(id, noteId, dto.originalName);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('courses', 'delete')
  @Delete('lessons/:id/notes/:noteId')
  deleteNote(@Param('id') id: string, @Param('noteId') noteId: string) {
    return this.lms.deleteNote(id, noteId);
  }

  // Member download (access-checked). Token via Authorization header OR a
  // ?token= query param (so a mobile browser open works). Admins bypass the
  // lock check (see LmsService.getDownloadableNote).
  @UseGuards(JwtDownloadGuard)
  @Get('lessons/:id/notes/:noteId/download')
  async downloadNote(
    @Param('id') id: string,
    @Param('noteId') noteId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Res() res: Response,
  ) {
    const { absPath, originalName } = await this.lms.getDownloadableNote(
      id,
      noteId,
      principal,
    );
    res.download(absPath, originalName);
  }
}
