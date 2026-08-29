import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { JwtService } from "@nestjs/jwt";
import type { Response } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { JwtDownloadGuard } from "../auth/guards/jwt-download.guard";
import {
  DOWNLOAD_TOKEN_TTL_SECONDS,
  helpdeskAttachmentDownloadScope,
  type DownloadTokenPayload,
} from "../auth/download-token.util";
import { OptionalJwtAuthGuard } from "../auth/guards/optional-jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedPrincipal } from "../auth/jwt-payload.interface";
import { HelpdeskService } from "./helpdesk.service";
import {
  RateConversationDto,
  ReplyDto,
  StartConversationDto,
  StatEventDto,
} from "./dto/helpdesk.dto";
import { helpdeskFilePath } from "./helpdesk-files.util";
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_BYTES,
} from "./helpdesk.config";

// The member-facing helpdesk. Every lookup is scoped to the signed-in member
// (principal.sub); a miss returns 404, never 403 (a 403 is an existence oracle).
@Controller("helpdesk")
export class HelpdeskController {
  constructor(
    private readonly helpdesk: HelpdeskService,
    private readonly jwt: JwtService,
  ) {}

  // Public-ish: works logged-out so the widget can tell a visitor to sign in.
  @UseGuards(OptionalJwtAuthGuard)
  @Get("config")
  config(@CurrentUser() p?: AuthenticatedPrincipal) {
    return this.helpdesk.config(p);
  }

  @UseGuards(JwtAuthGuard)
  @Get("articles")
  articles() {
    return this.helpdesk.articles();
  }

  @UseGuards(JwtAuthGuard)
  @Get("me/conversations")
  myConversations(@CurrentUser() p: AuthenticatedPrincipal) {
    return this.helpdesk.myConversations(p.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Get("me/unread-count")
  myUnread(@CurrentUser() p: AuthenticatedPrincipal) {
    return this.helpdesk.myUnreadCount(p.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post("conversations")
  start(
    @CurrentUser() p: AuthenticatedPrincipal,
    @Body() dto: StartConversationDto,
  ) {
    return this.helpdesk.start(p, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get("conversations/:id")
  thread(@CurrentUser() p: AuthenticatedPrincipal, @Param("id") id: string) {
    return this.helpdesk.threadForMember(p.sub, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post("conversations/:id/messages")
  reply(
    @CurrentUser() p: AuthenticatedPrincipal,
    @Param("id") id: string,
    @Body() dto: ReplyDto,
  ) {
    return this.helpdesk.replyAsMember(p, id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post("conversations/:id/read")
  read(@CurrentUser() p: AuthenticatedPrincipal, @Param("id") id: string) {
    return this.helpdesk.markReadMember(p.sub, id);
  }

  // The member closes their own request. Reversible — a later reply reopens.
  @UseGuards(JwtAuthGuard)
  @Post("conversations/:id/resolve")
  resolve(@CurrentUser() p: AuthenticatedPrincipal, @Param("id") id: string) {
    return this.helpdesk.resolveAsMember(p.sub, id);
  }

  // Once-per-resolution CSAT.
  @UseGuards(JwtAuthGuard)
  @Post("conversations/:id/rate")
  rate(
    @CurrentUser() p: AuthenticatedPrincipal,
    @Param("id") id: string,
    @Body() dto: RateConversationDto,
  ) {
    return this.helpdesk.rateAsMember(p.sub, id, dto);
  }

  // Attach up to 3 images to a member message the caller just posted. The image
  // is re-encoded server-side (strips EXIF/GPS, rejects non-images).
  @UseGuards(JwtAuthGuard)
  @Post("conversations/:id/messages/:messageId/attachments")
  @UseInterceptors(
    FilesInterceptor("files", MAX_ATTACHMENTS_PER_MESSAGE, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_ATTACHMENT_BYTES },
    }),
  )
  addAttachments(
    @CurrentUser() p: AuthenticatedPrincipal,
    @Param("id") id: string,
    @Param("messageId") messageId: string,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
  ) {
    return this.helpdesk.addMemberAttachments(
      p.sub,
      id,
      messageId,
      files ?? [],
    );
  }

  // Mint a short-lived, resource-scoped download token (owner only — an admin
  // uses the permission-gated /admin route). The image never rides a public URL.
  @UseGuards(JwtAuthGuard)
  @Get("attachments/:id/download-url")
  async attachmentDownloadUrl(
    @CurrentUser() p: AuthenticatedPrincipal,
    @Param("id") id: string,
  ): Promise<{ token: string }> {
    await this.helpdesk.attachmentForDownload(id, {
      userId: p.sub,
      allowAdmin: false,
    });
    const payload: DownloadTokenPayload = {
      sub: p.sub,
      isAdmin: p.isAdmin,
      typ: "dl",
      scope: helpdeskAttachmentDownloadScope(id),
    };
    const token = await this.jwt.signAsync(payload, {
      expiresIn: DOWNLOAD_TOKEN_TTL_SECONDS,
    });
    return { token };
  }

  // Access-checked download. Token via Authorization header OR ?token= (so an
  // <img> can render it). no-referrer keeps the token out of the Referer header.
  @UseGuards(JwtDownloadGuard)
  @Get("attachments/:id/download")
  async downloadAttachment(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    const att = await this.helpdesk.attachmentForDownload(id, {
      userId: principal.sub,
      allowAdmin: principal.isAdmin,
    });
    res.setHeader("Referrer-Policy", "no-referrer");
    res.download(helpdeskFilePath(att.fileKey), att.originalName);
  }

  // Fire-and-forget deflection counter (guided-phase analytics). Body-only, no
  // member identifier is stored.
  @UseGuards(JwtAuthGuard)
  @Post("stats/event")
  stat(@Body() dto: StatEventDto) {
    return this.helpdesk.recordStat(dto);
  }
}
