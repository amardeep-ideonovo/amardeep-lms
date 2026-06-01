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
import { MembersService } from './members.service';
import {
  AddMemberLevelDto,
  SetMemberPasswordDto,
  UpdateMemberDto,
} from './dto/member.dto';

@UseGuards(AdminGuard)
@Controller('members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  list() {
    return this.members.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.members.get(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateMemberDto) {
    return this.members.update(id, dto);
  }

  // Admin override: set a member's password without their current one.
  @Post(':id/password')
  setPassword(@Param('id') id: string, @Body() dto: SetMemberPasswordDto) {
    return this.members.setPassword(id, dto.newPassword);
  }

  @Post(':id/levels')
  addLevel(@Param('id') id: string, @Body() dto: AddMemberLevelDto) {
    return this.members.addLevel(id, dto.levelId);
  }

  @Delete(':id/levels/:levelId')
  removeLevel(@Param('id') id: string, @Param('levelId') levelId: string) {
    return this.members.removeLevel(id, levelId);
  }
}
