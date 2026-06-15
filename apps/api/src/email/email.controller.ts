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
import type {
  EmailSendResultDTO,
  RenderPreviewResult,
} from '@lms/types';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { EmailService } from './email.service';
import { EmailTemplateService } from './email-template.service';
import {
  CreateEmailTemplateDto,
  RenderPreviewDto,
  TestSendDto,
  UpdateEmailTemplateDto,
} from './dto/email-template.dto';

// Admin CRUD + live-editor tooling for email templates (MJML + Handlebars). All
// routes sit under /admin/email/* behind the `email` permission — same
// guard/decorator pattern as ContactsController. `preview` renders ad-hoc (no
// saved row) for the editor; `test-send` renders a saved template and dispatches
// a real (un-deduped) email so an admin can sanity-check it.
@Controller()
export class EmailController {
  constructor(
    private readonly templates: EmailTemplateService,
    private readonly email: EmailService,
  ) {}

  @UseGuards(PermissionsGuard)
  @RequirePermission('email', 'read')
  @Get('admin/email/templates')
  list() {
    return this.templates.list();
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('email', 'create')
  @Post('admin/email/templates')
  create(@Body() dto: CreateEmailTemplateDto) {
    return this.templates.create(dto);
  }

  // Ad-hoc render for the live editor preview (does NOT need a saved row).
  // Placed before the :id routes so "preview" can't be swallowed as an :id.
  @UseGuards(PermissionsGuard)
  @RequirePermission('email', 'read')
  @Post('admin/email/templates/preview')
  preview(@Body() dto: RenderPreviewDto): RenderPreviewResult {
    const { subject, html } = this.templates.render(
      { subject: dto.subject, mjml: dto.mjml },
      dto.vars ?? {},
    );
    return { subject, html };
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('email', 'read')
  @Get('admin/email/templates/:id')
  get(@Param('id') id: string) {
    return this.templates.get(id);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('email', 'edit')
  @Patch('admin/email/templates/:id')
  update(@Param('id') id: string, @Body() dto: UpdateEmailTemplateDto) {
    return this.templates.update(id, dto);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('email', 'delete')
  @Delete('admin/email/templates/:id')
  remove(@Param('id') id: string) {
    return this.templates.deleteTemplate(id);
  }

  // Render + dispatch a real test email for the saved template (no dedupeKey, so
  // it always sends). Returns the EmailLog ledger status so the admin sees
  // SENT / FAILED (and the error, if any) in a toast.
  @UseGuards(PermissionsGuard)
  @RequirePermission('email', 'edit')
  @Post('admin/email/templates/:id/test-send')
  async testSend(
    @Param('id') id: string,
    @Body() dto: TestSendDto,
  ): Promise<EmailSendResultDTO> {
    const log = await this.email.sendTemplate({
      to: dto.to,
      templateId: id,
      vars: dto.vars ?? {},
    });
    return {
      id: log.id,
      to: log.to,
      subject: log.subject,
      status: log.status,
      error: log.error,
    };
  }
}
