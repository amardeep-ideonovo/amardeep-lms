import { Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedPrincipal } from "../auth/jwt-payload.interface";
import { MemberNotificationsService } from "./member-notifications.service";

// Member-facing in-app notification inbox. Same JWT guard members and admins
// share (NOT the admin RBAC guard); every row is scoped to the member id from
// the JWT (principal.sub), never the client. Admin principals have no User row,
// so their reads return an empty feed rather than 500 on a dangling FK.
@UseGuards(JwtAuthGuard)
@Controller("notifications")
export class MemberNotificationsController {
  constructor(private readonly notifications: MemberNotificationsService) {}

  @Get()
  list(
    @CurrentUser() p: AuthenticatedPrincipal,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    if (p.isAdmin)
      return { items: [], total: 0, page: 1, pageSize: 20, unreadCount: 0 };
    return this.notifications.list({
      userId: p.sub,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get("unread-count")
  unreadCount(@CurrentUser() p: AuthenticatedPrincipal) {
    if (p.isAdmin) return { count: 0 };
    return this.notifications.unreadCount(p.sub);
  }

  // 'read-all' is a single segment, declared BEFORE ':id/read' so it never
  // collides with the two-segment route below.
  @Post("read-all")
  markAllRead(@CurrentUser() p: AuthenticatedPrincipal) {
    if (p.isAdmin) return { ok: true as const };
    return this.notifications.markAllRead(p.sub);
  }

  @Post(":id/read")
  markRead(@CurrentUser() p: AuthenticatedPrincipal, @Param("id") id: string) {
    if (p.isAdmin) return { ok: true as const };
    return this.notifications.markRead(p.sub, id);
  }
}
