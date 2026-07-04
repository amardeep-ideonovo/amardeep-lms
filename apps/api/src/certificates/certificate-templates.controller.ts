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
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { CertificateTemplatesService } from './certificate-templates.service';
import {
  CreateCertificateTemplateDto,
  UpdateCertificateTemplateDto,
} from './dto/certificate.dto';

// Admin CRUD for certificate templates (artwork + visual field layout).
// All routes live under /admin/* behind the `certificates` permission.
@Controller('admin/certificate-templates')
@UseGuards(PermissionsGuard)
export class CertificateTemplatesController {
  constructor(private readonly templates: CertificateTemplatesService) {}

  @RequirePermission('certificates', 'read')
  @Get()
  list() {
    return this.templates.list();
  }

  @RequirePermission('certificates', 'read')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.templates.get(id);
  }

  @RequirePermission('certificates', 'create')
  @Post()
  create(@Body() dto: CreateCertificateTemplateDto) {
    return this.templates.create(dto);
  }

  @RequirePermission('certificates', 'edit')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCertificateTemplateDto) {
    return this.templates.update(id, dto);
  }

  @RequirePermission('certificates', 'delete')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.templates.remove(id);
  }
}
