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
import { LevelsService } from './levels.service';
import { CreateLevelDto, UpdateLevelDto } from './dto/level.dto';

@Controller('levels')
export class LevelsController {
  constructor(private readonly levels: LevelsService) {}

  // Listing is member-accessible (powers the subscribe/plan picker); writes are
  // admin-only.
  @UseGuards(JwtAuthGuard)
  @Get()
  list() {
    return this.levels.list();
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
