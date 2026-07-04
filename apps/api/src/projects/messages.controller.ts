import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedPrincipal } from '../auth/jwt-payload.interface';
import { MessagesService } from './messages.service';
import {
  EditMessageDto,
  ListMessagesQueryDto,
  MarkReadDto,
  MessageToTaskDto,
  ReactionToggleDto,
  SendMessageDto,
} from './dto/projects.dto';

// Messages, threads, reactions, read-markers + the batch unread summary. All
// admin-only behind the `projects` permission (same guard stack as Contacts /
// Settings). Routes split across two base paths (channel-scoped vs message-by-id
// vs the unread digest), so the @Controller has no shared prefix.
@UseGuards(PermissionsGuard)
@Controller()
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  // ----- Channel-scoped -----

  @Get('admin/projects/channels/:id/messages')
  @RequirePermission('projects', 'read')
  list(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Query() query: ListMessagesQueryDto,
  ) {
    return this.messages.listMessages(principal.sub, id, {
      afterSeq: query.afterSeq,
      limit: query.limit,
    });
  }

  @Post('admin/projects/channels/:id/messages')
  @RequirePermission('projects', 'create')
  send(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.messages.createMessage(principal.sub, id, dto);
  }

  @Post('admin/projects/channels/:id/read')
  @RequirePermission('projects', 'read')
  markRead(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body() dto: MarkReadDto,
  ) {
    return this.messages.markRead(principal.sub, id, dto.seq);
  }

  // ----- Message-by-id -----

  @Patch('admin/projects/messages/:id')
  @RequirePermission('projects', 'edit')
  edit(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body() dto: EditMessageDto,
  ) {
    return this.messages.editMessage(principal.sub, id, dto.body);
  }

  @Delete('admin/projects/messages/:id')
  @RequirePermission('projects', 'delete')
  remove(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
  ) {
    return this.messages.deleteMessage(principal.sub, id);
  }

  @Get('admin/projects/messages/:id/replies')
  @RequirePermission('projects', 'read')
  replies(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
  ) {
    return this.messages.listReplies(principal.sub, id);
  }

  @Post('admin/projects/messages/:id/reactions')
  @RequirePermission('projects', 'edit')
  toggleReaction(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body() dto: ReactionToggleDto,
  ) {
    return this.messages.toggleReaction(principal.sub, id, dto.emoji);
  }

  @Post('admin/projects/messages/:id/to-task')
  @RequirePermission('projects', 'create')
  toTask(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body() dto: MessageToTaskDto,
  ) {
    return this.messages.messageToTask(principal.sub, id, dto);
  }

  // ----- Unread digest (single batch query) -----

  @Get('admin/projects/unread')
  @RequirePermission('projects', 'read')
  unread(@CurrentUser() principal: AuthenticatedPrincipal) {
    return this.messages.unreadSummary(principal.sub);
  }
}
