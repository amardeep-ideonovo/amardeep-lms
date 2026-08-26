import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { JwtService } from "@nestjs/jwt";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { RequirePermission } from "../auth/require-permission.decorator";
import {
  DOWNLOAD_TOKEN_TTL_SECONDS,
  helpdeskAttachmentDownloadScope,
  type DownloadTokenPayload,
} from "../auth/download-token.util";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedPrincipal } from "../auth/jwt-payload.interface";
import { HelpdeskService } from "./helpdesk.service";
import {
  AdminListQueryDto,
  AdminReplyDto,
  ArticleCreateDto,
  ArticleUpdateDto,
  AssignDto,
  UpdateTicketDto,
} from "./dto/helpdesk.dto";
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_BYTES,
} from "./helpdesk.config";

// Member-support transcripts + tickets. Class-level @RequirePermission is a
// FLOOR: PermissionsGuard fails open on an untagged handler, so the class tag
// guarantees every route needs at least helpdesk:read (write routes override
// to helpdesk:edit).
@UseGuards(PermissionsGuard)
@RequirePermission("helpdesk", "read")
@Controller("admin/helpdesk")
export class HelpdeskAdminController {
  constructor(
    private readonly helpdesk: HelpdeskService,
    private readonly jwt: JwtService,
  ) {}

  @Get("conversations")
  list(@Query() q: AdminListQueryDto) {
    return this.helpdesk.adminList(q);
  }

  @Get("unread-count")
  unread() {
    return this.helpdesk.adminUnreadCount();
  }

  @Get("stats")
  stats(@Query("days") days?: string) {
    return this.helpdesk.adminStats(Number(days) || 30);
  }

  @Get("conversations/:id")
  thread(@Param("id") id: string) {
    return this.helpdesk.adminThread(id);
  }

  @Post("conversations/:id/read")
  read(@Param("id") id: string) {
    return this.helpdesk.adminMarkRead(id);
  }

  @RequirePermission("helpdesk", "edit")
  @Post("conversations/:id/messages")
  reply(
    @CurrentUser() admin: AuthenticatedPrincipal,
    @Param("id") id: string,
    @Body() dto: AdminReplyDto,
  ) {
    return this.helpdesk.adminReply(admin, id, dto);
  }

  @RequirePermission("helpdesk", "edit")
  @Post("conversations/:id/assign")
  assign(@Param("id") id: string, @Body() dto: AssignDto) {
    return this.helpdesk.adminAssign(id, dto.assigneeAdminId ?? null);
  }

  @RequirePermission("helpdesk", "edit")
  @Patch("conversations/:id/ticket")
  updateTicket(@Param("id") id: string, @Body() dto: UpdateTicketDto) {
    return this.helpdesk.adminUpdateTicket(id, dto);
  }

  @RequirePermission("helpdesk", "edit")
  @Post("conversations/:id/resolve")
  resolve(@Param("id") id: string) {
    return this.helpdesk.adminResolve(id);
  }

  @RequirePermission("helpdesk", "edit")
  @Post("conversations/:id/close")
  close(@Param("id") id: string) {
    return this.helpdesk.adminClose(id);
  }

  // Mint a download token for an attachment (any conversation — this class is
  // gated on helpdesk:read). The shared /helpdesk/attachments/:id/download
  // route serves it (the token carries isAdmin, so that route allows it).
  @Get("attachments/:id/download-url")
  async attachmentDownloadUrl(
    @CurrentUser() admin: AuthenticatedPrincipal,
    @Param("id") id: string,
  ): Promise<{ token: string }> {
    await this.helpdesk.attachmentForDownload(id, {
      userId: admin.sub,
      allowAdmin: true,
    });
    const payload: DownloadTokenPayload = {
      sub: admin.sub,
      isAdmin: true,
      typ: "dl",
      scope: helpdeskAttachmentDownloadScope(id),
    };
    const token = await this.jwt.signAsync(payload, {
      expiresIn: DOWNLOAD_TOKEN_TTL_SECONDS,
    });
    return { token };
  }

  @RequirePermission("helpdesk", "edit")
  @Post("conversations/:id/messages/:messageId/attachments")
  @UseInterceptors(
    FilesInterceptor("files", MAX_ATTACHMENTS_PER_MESSAGE, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_ATTACHMENT_BYTES },
    }),
  )
  addAttachments(
    @Param("id") id: string,
    @Param("messageId") messageId: string,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
  ) {
    return this.helpdesk.addAdminAttachments(id, messageId, files ?? []);
  }

  // ---- FAQ articles (member "Something else" screen reads the published ones) ----
  @Get("articles")
  articles() {
    return this.helpdesk.listArticlesAdmin();
  }

  @RequirePermission("helpdesk", "create")
  @Post("articles")
  createArticle(@Body() dto: ArticleCreateDto) {
    return this.helpdesk.createArticle(dto);
  }

  @RequirePermission("helpdesk", "edit")
  @Patch("articles/:id")
  updateArticle(@Param("id") id: string, @Body() dto: ArticleUpdateDto) {
    return this.helpdesk.updateArticle(id, dto);
  }

  @RequirePermission("helpdesk", "delete")
  @Delete("articles/:id")
  deleteArticle(@Param("id") id: string) {
    return this.helpdesk.deleteArticle(id);
  }
}
