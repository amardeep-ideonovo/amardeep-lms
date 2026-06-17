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
import { ListsService } from './lists.service';
import {
  CreateListDto,
  CreateListFieldDto,
  CreateListItemCommentDto,
  CreateListItemDto,
  ListListsQueryDto,
  ReorderListFieldsDto,
  UpdateListFieldDto,
  UpdateListItemCommentDto,
  UpdateListItemDto,
  UpdateListItemValuesDto,
} from './dto/projects.dto';

// Slack-Lists-style task boards. Admin-only behind the `projects` permission.
// Routes span two base paths (lists vs list-items), so no shared prefix.
@UseGuards(PermissionsGuard)
@Controller()
export class ListsController {
  constructor(private readonly lists: ListsService) {}

  @Get('admin/projects/lists')
  @RequirePermission('projects', 'read')
  list(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: ListListsQueryDto,
  ) {
    return this.lists.listLists(principal.sub, query.channelId);
  }

  @Post('admin/projects/lists')
  @RequirePermission('projects', 'create')
  create(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: CreateListDto,
  ) {
    return this.lists.createList(principal.sub, dto);
  }

  @Post('admin/projects/lists/:id/items')
  @RequirePermission('projects', 'create')
  addItem(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body() dto: CreateListItemDto,
  ) {
    return this.lists.addItem(principal.sub, id, dto);
  }

  @Patch('admin/projects/list-items/:id')
  @RequirePermission('projects', 'edit')
  updateItem(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body() dto: UpdateListItemDto,
  ) {
    return this.lists.updateItem(principal.sub, id, dto);
  }

  @Delete('admin/projects/list-items/:id')
  @RequirePermission('projects', 'delete')
  deleteItem(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
  ) {
    return this.lists.deleteItem(principal.sub, id);
  }

  // ----- Custom fields (columns) -----

  @Post('admin/projects/lists/:id/fields')
  @RequirePermission('projects', 'create')
  createField(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body() dto: CreateListFieldDto,
  ) {
    return this.lists.createField(principal.sub, id, dto);
  }

  @Post('admin/projects/lists/:id/fields/reorder')
  @RequirePermission('projects', 'edit')
  reorderFields(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body() dto: ReorderListFieldsDto,
  ) {
    return this.lists.reorderFields(principal.sub, id, dto.orderedFieldIds);
  }

  @Patch('admin/projects/list-fields/:fieldId')
  @RequirePermission('projects', 'edit')
  updateField(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('fieldId') fieldId: string,
    @Body() dto: UpdateListFieldDto,
  ) {
    return this.lists.updateField(principal.sub, fieldId, dto);
  }

  @Delete('admin/projects/list-fields/:fieldId')
  @RequirePermission('projects', 'delete')
  deleteField(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('fieldId') fieldId: string,
  ) {
    return this.lists.deleteField(principal.sub, fieldId);
  }

  // ----- Item custom-field values -----

  @Patch('admin/projects/list-items/:id/values')
  @RequirePermission('projects', 'edit')
  updateItemValues(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body() dto: UpdateListItemValuesDto,
  ) {
    return this.lists.updateItemValues(principal.sub, id, dto.values);
  }

  // ----- Per-item comments (the 💬 thread) -----

  @Get('admin/projects/list-items/:id/comments')
  @RequirePermission('projects', 'read')
  listComments(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
  ) {
    return this.lists.listComments(principal.sub, id);
  }

  @Post('admin/projects/list-items/:id/comments')
  @RequirePermission('projects', 'create')
  addComment(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body() dto: CreateListItemCommentDto,
  ) {
    return this.lists.addComment(principal.sub, id, dto.body);
  }

  @Patch('admin/projects/list-item-comments/:cid')
  @RequirePermission('projects', 'edit')
  updateComment(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('cid') cid: string,
    @Body() dto: UpdateListItemCommentDto,
  ) {
    return this.lists.updateComment(principal.sub, cid, dto.body);
  }

  @Delete('admin/projects/list-item-comments/:cid')
  @RequirePermission('projects', 'delete')
  deleteComment(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('cid') cid: string,
  ) {
    return this.lists.deleteComment(principal.sub, cid);
  }
}
