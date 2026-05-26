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
import { CreateLevelDto, UpdateLevelDto } from './dto/level.dto';

@Controller('levels')
export class LevelsController {
  constructor(private readonly levels: LevelsService) {}

  // Listing is member-accessible (powers the subscribe/plan picker); writes are
  // admin-only. Member counts are only included for admins.
  @UseGuards(JwtAuthGuard)
  @Get()
  list(@CurrentUser() principal: AuthenticatedPrincipal) {
    return this.levels.list(principal.isAdmin);
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
