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
import type {
  EmailLogListDTO,
  EmailSendResultDTO,
  RenderPreviewResult,
} from '@lms/types';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { EmailService } from './email.service';
import { ResendMailSender } from './resend.sender';
import { SettingsService } from '../settings/settings.service';
import { EmailTemplateService } from './email-template.service';
import { CampaignService } from './campaign.service';
import { AutomationService } from './automation.service';
import { EmailLogService } from './email-log.service';
import {
  CreateEmailTemplateDto,
  RenderPreviewDto,
  TestSendDto,
  UpdateEmailTemplateDto,
} from './dto/email-template.dto';
import { AutomationDto, CampaignDto } from './dto/campaign.dto';

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
    private readonly campaigns: CampaignService,
    private readonly automations: AutomationService,
    private readonly logs: EmailLogService,
    private readonly resend: ResendMailSender,
    private readonly settings: SettingsService,
  ) {}

  // Deliverability health for the admin Email settings card. When the active
  // provider is Resend, a live check against Resend's /domains tells the admin
  // whether the From domain is actually VERIFIED — Resend silently drops sends
  // from an unverified domain, so isConfigured() true is not enough. null =
  // provider isn't Resend, not configured, or Resend was unreachable (no verdict).
  @UseGuards(PermissionsGuard)
  @RequirePermission('email', 'read')
  @Get('admin/email/health')
  async health(): Promise<{
    provider: 'smtp' | 'resend';
    resendDomainVerified: boolean | null;
  }> {
    const provider = await this.settings.getEmailProvider();
    const resendDomainVerified =
      provider === 'resend' ? await this.resend.domainVerified() : null;
    return { provider, resendDomainVerified };
  }

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

  // ───────────────────────── Logs (send ledger) ─────────────────────────

  // Paginated EmailLog viewer. Optional ?status (QUEUED|SENT|FAILED|BOUNCED|
  // COMPLAINED) and ?q (matches recipient or subject). Read-only.
  @UseGuards(PermissionsGuard)
  @RequirePermission('email', 'read')
  @Get('admin/email/logs')
  listLogs(
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<EmailLogListDTO> {
    return this.logs.list({
      status,
      q,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  // ───────────────────────── Campaigns ─────────────────────────

  @UseGuards(PermissionsGuard)
  @RequirePermission('email', 'read')
  @Get('admin/email/campaigns')
  listCampaigns() {
    return this.campaigns.list();
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('email', 'create')
  @Post('admin/email/campaigns')
  createCampaign(@Body() dto: CampaignDto) {
    return this.campaigns.create(dto);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('email', 'read')
  @Get('admin/email/campaigns/:id')
  getCampaign(@Param('id') id: string) {
    return this.campaigns.get(id);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('email', 'edit')
  @Patch('admin/email/campaigns/:id')
  updateCampaign(@Param('id') id: string, @Body() dto: CampaignDto) {
    return this.campaigns.update(id, dto);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('email', 'delete')
  @Delete('admin/email/campaigns/:id')
  removeCampaign(@Param('id') id: string) {
    return this.campaigns.remove(id);
  }

  // Arm the campaign (status → SCHEDULED, nextRunAt computed).
  @UseGuards(PermissionsGuard)
  @RequirePermission('email', 'edit')
  @Post('admin/email/campaigns/:id/schedule')
  scheduleCampaign(@Param('id') id: string) {
    return this.campaigns.schedule(id);
  }

  // Pause a scheduled campaign (the scheduler skips PAUSED).
  @UseGuards(PermissionsGuard)
  @RequirePermission('email', 'edit')
  @Post('admin/email/campaigns/:id/pause')
  pauseCampaign(@Param('id') id: string) {
    return this.campaigns.pause(id);
  }

  // ───────────────────────── Automations ─────────────────────────

  @UseGuards(PermissionsGuard)
  @RequirePermission('email', 'read')
  @Get('admin/email/automations')
  listAutomations() {
    return this.automations.list();
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('email', 'create')
  @Post('admin/email/automations')
  createAutomation(@Body() dto: AutomationDto) {
    return this.automations.create(dto);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('email', 'edit')
  @Patch('admin/email/automations/:id')
  updateAutomation(@Param('id') id: string, @Body() dto: AutomationDto) {
    return this.automations.update(id, dto);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('email', 'delete')
  @Delete('admin/email/automations/:id')
  removeAutomation(@Param('id') id: string) {
    return this.automations.remove(id);
  }
}
