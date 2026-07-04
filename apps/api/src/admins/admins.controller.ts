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
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedPrincipal } from '../auth/jwt-payload.interface';
import { AdminsService } from './admins.service';
import {
  CreateAdminDto,
  ResetAdminPasswordDto,
  UpdateAdminDto,
} from './dto/admins.dto';

// Admin account management + RBAC. SUPER_ADMIN only (only the super admin can
// add/manage admins).
@UseGuards(SuperAdminGuard)
@Controller('admin/admins')
export class AdminsController {
  constructor(private readonly admins: AdminsService) {}

  @Get()
  list() {
    return this.admins.list();
  }

  @Post()
  create(@Body() dto: CreateAdminDto) {
    return this.admins.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAdminDto) {
    return this.admins.update(id, dto);
  }

  @Post(':id/password')
  resetPassword(@Param('id') id: string, @Body() dto: ResetAdminPasswordDto) {
    return this.admins.resetPassword(id, dto.password);
  }

  @Delete(':id')
  remove(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
  ) {
    return this.admins.remove(principal.sub, id);
  }
}
