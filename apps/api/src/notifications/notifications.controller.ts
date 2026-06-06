import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedPrincipal } from '../auth/jwt-payload.interface';
import { NotificationsService } from './notifications.service';

// Admin-only in-app notification feed. Read state is per-admin: the admin id is
// taken from the JWT principal (`sub`), never from the client.
@UseGuards(AdminGuard)
@Controller('admin/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.notifications.list({
      adminId: principal.sub,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() principal: AuthenticatedPrincipal) {
    return this.notifications.unreadCount(principal.sub);
  }

  // NOTE: 'read-all' is a single path segment, so it never collides with the
  // two-segment ':id/read' route below.
  @Post('read-all')
  markAllRead(@CurrentUser() principal: AuthenticatedPrincipal) {
    return this.notifications.markAllRead(principal.sub);
  }

  @Post(':id/read')
  markRead(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
  ) {
    return this.notifications.markRead(principal.sub, id);
  }
}
