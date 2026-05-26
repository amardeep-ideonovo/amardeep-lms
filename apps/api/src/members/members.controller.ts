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
import { AddMemberLevelDto, UpdateMemberDto } from './dto/member.dto';

@UseGuards(AdminGuard)
@Controller('members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  list() {
    return this.members.list();
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateMemberDto) {
    return this.members.update(id, dto);
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
