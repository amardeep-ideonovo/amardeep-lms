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
import { WorkflowsService } from './workflows.service';
import {
  CreateWorkflowDto,
  ListWorkflowsQueryDto,
  UpdateWorkflowDto,
} from './dto/projects.dto';

// Workflows: auto-post a list event into a channel (the Slack "Web Queue
// Workflow" flow). Admin-only behind the `projects` permission, same guard stack
// as the rest of Projects.
@UseGuards(PermissionsGuard)
@Controller()
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

  @Get('admin/projects/workflows')
  @RequirePermission('projects', 'read')
  list(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: ListWorkflowsQueryDto,
  ) {
    return this.workflows.list(principal.sub, query.listId);
  }

  @Post('admin/projects/workflows')
  @RequirePermission('projects', 'create')
  create(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: CreateWorkflowDto,
  ) {
    return this.workflows.create(principal.sub, dto);
  }

  @Patch('admin/projects/workflows/:id')
  @RequirePermission('projects', 'edit')
  update(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body() dto: UpdateWorkflowDto,
  ) {
    return this.workflows.update(principal.sub, id, dto);
  }

  @Delete('admin/projects/workflows/:id')
  @RequirePermission('projects', 'delete')
  remove(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
  ) {
    return this.workflows.remove(principal.sub, id);
  }
}
