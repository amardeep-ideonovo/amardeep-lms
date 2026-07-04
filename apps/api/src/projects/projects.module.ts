import { Module } from '@nestjs/common';
import { ChannelsService } from './channels.service';
import { DmsService } from './dms.service';
import { MessagesService } from './messages.service';
import { ListsService } from './lists.service';
import { WorkflowsService } from './workflows.service';
import { CanvasService } from './canvas.service';
import { ChannelsController } from './channels.controller';
import { DmsController } from './dms.controller';
import { MessagesController } from './messages.controller';
import { ListsController } from './lists.controller';
import { WorkflowsController } from './workflows.controller';
import { CanvasController } from './canvas.controller';
import { ProjectsGateway } from './projects.gateway';
import { AuthModule } from '../auth/auth.module';

// Projects: an internal-staff (admin-only) Slack-style team tool — channels,
// messages (threads/reactions/mentions/unread), and task lists.
//
// Phase 3 adds a realtime Socket.IO gateway (ProjectsGateway) that broadcasts
// message/reaction events to channel rooms. MessagesService injects the gateway
// and emits after each write; the gateway injects ChannelsService (for
// assertVisible) and JwtService (handshake auth, via AuthModule's exported
// JwtModule — reusing the same JWT_SECRET). ListsService also injects the
// gateway to emit `chat:list:update` when a list's fields/items/comments change.
// The dependency graph stays acyclic:
//   ProjectsGateway -> ChannelsService
//   MessagesService -> ProjectsGateway, ChannelsService
//   ListsService    -> ProjectsGateway, ChannelsService
// ChannelsService depends on neither, so there is no DI cycle (no forwardRef).
//
// Workflows (the Slack "Web Queue Workflow" flow) add one more leaf service:
//   WorkflowsService -> ProjectsGateway, ChannelsService, PrismaService
//   ListsService     -> WorkflowsService   (fires triggers after a write)
//   MessagesService  -> WorkflowsService   (enriches message DTOs with cards)
// WorkflowsService depends on NEITHER ListsService NOR MessagesService — it
// posts messages by writing ChatMessage rows directly via Prisma — so the graph
// stays acyclic (no back-edge, no forwardRef).
//
// Canvas docs (channel rich-text tabs) add one more LEAF:
//   CanvasService -> PrismaService   (injects nothing else)
// so the graph stays acyclic.
//
// PrismaService comes from the global PrismaModule, so nothing extra is imported.
@Module({
  imports: [AuthModule],
  providers: [
    ChannelsService,
    DmsService,
    MessagesService,
    ListsService,
    WorkflowsService,
    CanvasService,
    ProjectsGateway,
  ],
  controllers: [
    ChannelsController,
    DmsController,
    MessagesController,
    ListsController,
    WorkflowsController,
    CanvasController,
  ],
})
export class ProjectsModule {}
