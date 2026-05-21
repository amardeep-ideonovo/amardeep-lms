import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedPrincipal } from '../auth/jwt-payload.interface';
import { LmsService } from './lms.service';
import {
  CreateCategoryDto,
  CreateCourseDto,
  CreateLessonDto,
  UpdateCourseDto,
} from './dto/lms.dto';

// LMS routes. Reads are member-authenticated (and access-aware); writes are
// admin-only. `userId` is omitted for admins so they see everything unlocked.
@Controller()
export class LmsController {
  constructor(private readonly lms: LmsService) {}

  private memberContext(principal: AuthenticatedPrincipal): string | undefined {
    return principal.isAdmin ? undefined : principal.sub;
  }

  // ----- Categories -----

  @UseGuards(JwtAuthGuard)
  @Get('categories')
  listCategories() {
    return this.lms.listCategories();
  }

  @UseGuards(AdminGuard)
  @Post('categories')
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.lms.createCategory(dto);
  }

  // ----- Courses -----

  @UseGuards(JwtAuthGuard)
  @Get('courses')
  listCourses(@CurrentUser() principal: AuthenticatedPrincipal) {
    return this.lms.listCourses(this.memberContext(principal));
  }

  @UseGuards(AdminGuard)
  @Post('courses')
  createCourse(@Body() dto: CreateCourseDto) {
    return this.lms.createCourse(dto);
  }

  @UseGuards(AdminGuard)
  @Patch('courses/:id')
  updateCourse(@Param('id') id: string, @Body() dto: UpdateCourseDto) {
    return this.lms.updateCourse(id, dto);
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

  @UseGuards(AdminGuard)
  @Post('courses/:id/lessons')
  createLesson(@Param('id') id: string, @Body() dto: CreateLessonDto) {
    return this.lms.createLesson(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('lessons/:id')
  getLesson(
    @Param('id') id: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ) {
    return this.lms.getLesson(id, principal.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post('lessons/:id/complete')
  completeLesson(
    @Param('id') id: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ) {
    return this.lms.completeLesson(id, principal.sub);
  }
}
