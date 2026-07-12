import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedPrincipal } from '../auth/jwt-payload.interface';
import { SupportService } from './support.service';
import { CsatDto, RaiseTicketDto, ReplyDto } from './dto/support.dto';

// Admin-only support surface. Tickets are org-level (every admin sees every
// ticket); the raiser id comes from the JWT principal, never the client.
@UseGuards(AdminGuard)
@Controller('admin/support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Get('tickets')
  list() {
    return this.support.list();
  }

  @Get('unread-count')
  unread() {
    return this.support.unreadCount();
  }

  @Post('tickets')
  raise(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: RaiseTicketDto,
  ) {
    return this.support.raise(principal, dto);
  }

  @Get('tickets/:id')
  thread(@Param('id') id: string) {
    return this.support.thread(id);
  }

  @Post('tickets/:id/messages')
  reply(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body() dto: ReplyDto,
  ) {
    return this.support.reply(principal, id, dto);
  }

  @Post('tickets/:id/csat')
  csat(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body() dto: CsatDto,
  ) {
    return this.support.csat(principal, id, dto);
  }
}
