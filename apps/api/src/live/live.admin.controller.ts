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
import { LiveService } from './live.service';
import {
  CreateLiveSessionDto,
  UpdateLiveSessionDto,
} from './dto/live-session.input';

// Admin management of live sessions. All routes sit behind the `liveSessions`
// permission (SUPER_ADMIN bypasses). Credentials are write-only: list/read never
// decrypt; only /reveal (edit) returns the plaintext link for a test-join.
@UseGuards(PermissionsGuard)
@Controller('admin/live-sessions')
export class LiveAdminController {
  constructor(private readonly live: LiveService) {}

  @RequirePermission('liveSessions', 'read')
  @Get()
  list() {
    return this.live.adminList();
  }

  @RequirePermission('liveSessions', 'read')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.live.adminGet(id);
  }

  @RequirePermission('liveSessions', 'edit')
  @Get(':id/reveal')
  reveal(@Param('id') id: string) {
    return this.live.adminReveal(id);
  }

  @RequirePermission('liveSessions', 'create')
  @Post()
  create(@Body() dto: CreateLiveSessionDto) {
    return this.live.adminCreate(dto);
  }

  @RequirePermission('liveSessions', 'edit')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateLiveSessionDto) {
    return this.live.adminUpdate(id, dto);
  }

  @RequirePermission('liveSessions', 'edit')
  @Post(':id/publish')
  publish(@Param('id') id: string) {
    return this.live.publish(id);
  }

  @RequirePermission('liveSessions', 'delete')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.live.adminDelete(id);
  }
}
