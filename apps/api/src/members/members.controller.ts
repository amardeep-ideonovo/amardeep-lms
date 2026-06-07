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
import { MembersService } from './members.service';
import {
  AddMemberLevelDto,
  SetMemberPasswordDto,
  UpdateMemberDto,
} from './dto/member.dto';

@UseGuards(PermissionsGuard)
@Controller('members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @RequirePermission('members', 'read')
  list() {
    return this.members.list();
  }

  @Get(':id')
  @RequirePermission('members', 'read')
  get(@Param('id') id: string) {
    return this.members.get(id);
  }

  @Patch(':id')
  @RequirePermission('members', 'edit')
  update(@Param('id') id: string, @Body() dto: UpdateMemberDto) {
    return this.members.update(id, dto);
  }

  // Admin override: set a member's password without their current one.
  @Post(':id/password')
  @RequirePermission('members', 'edit')
  setPassword(@Param('id') id: string, @Body() dto: SetMemberPasswordDto) {
    return this.members.setPassword(id, dto.newPassword);
  }

  @Post(':id/levels')
  @RequirePermission('members', 'edit')
  addLevel(@Param('id') id: string, @Body() dto: AddMemberLevelDto) {
    return this.members.addLevel(id, dto.levelId);
  }

  @Delete(':id/levels/:levelId')
  @RequirePermission('members', 'edit')
  removeLevel(@Param('id') id: string, @Param('levelId') levelId: string) {
    return this.members.removeLevel(id, levelId);
  }
}
