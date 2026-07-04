import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { FormsService } from './forms.service';
import { CreateFormDto, FormSubmitDto, UpdateFormDto } from './dto/form.dto';

// Form routes. The /forms/* reads + submit are PUBLIC (no guard) and only ACTIVE
// forms are exposed. All management + the in-house audience lookups live under
// /admin/* behind the `forms` permission.
@Controller()
export class FormsController {
  constructor(private readonly forms: FormsService) {}

  // ----- Public (no auth) -----

  @Get('forms/:id')
  getPublic(@Param('id') id: string) {
    return this.forms.getPublic(id);
  }

  @Post('forms/:id/submit')
  submit(@Param('id') id: string, @Body() dto: FormSubmitDto) {
    return this.forms.submit(id, dto.values);
  }

  // Paste-anywhere embed widget: <script src="…/forms/:id/embed.js"></script>.
  @Get('forms/:id/embed.js')
  embedScript(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const base =
      process.env.PUBLIC_API_URL?.replace(/\/$/, '') ||
      `${req.protocol}://${req.get('host')}`;
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(this.forms.buildEmbedScript(id, base));
  }

  // The form editor's audience picker + field mapper read OUR in-house list via
  // the canonical contacts endpoints (GET /admin/audiences and
  // /admin/audiences/:id/fields on ContactsController), so this controller no
  // longer exposes any audience lookups of its own.

  // ----- Admin: form CRUD -----

  @UseGuards(PermissionsGuard)
  @RequirePermission('forms', 'read')
  @Get('admin/forms')
  adminList() {
    return this.forms.adminList();
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('forms', 'read')
  @Get('admin/forms/:id')
  adminGet(@Param('id') id: string) {
    return this.forms.adminGet(id);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('forms', 'read')
  @Get('admin/forms/:id/submissions')
  adminListSubmissions(@Param('id') id: string) {
    return this.forms.listSubmissions(id);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('forms', 'create')
  @Post('admin/forms')
  adminCreate(@Body() dto: CreateFormDto) {
    return this.forms.adminCreate(dto);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('forms', 'edit')
  @Patch('admin/forms/:id')
  adminUpdate(@Param('id') id: string, @Body() dto: UpdateFormDto) {
    return this.forms.adminUpdate(id, dto);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('forms', 'delete')
  @Delete('admin/forms/:id')
  adminDelete(@Param('id') id: string) {
    return this.forms.adminDelete(id);
  }
}
