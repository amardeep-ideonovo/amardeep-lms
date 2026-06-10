import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { ReportFilterDto } from './dto/report-filter.dto';
import { ReportsService } from './reports.service';

const XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Admin Reports tab — on-demand Excel (.xlsx) exports. Read-only: each route just
// generates a workbook from existing data. Binary bodies are written via @Res()
// (same pattern as the forms embed.js and lesson-note download); the auth guard
// still runs (guards execute before the handler) and there is no global response
// interceptor to bypass. Filenames are static literals (no header-injection risk);
// the admin client sets its own download filename, so this one is just a default.
@UseGuards(PermissionsGuard)
@Controller('admin/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('members.xlsx')
  @RequirePermission('reports', 'read')
  async members(@Res() res: Response, @Query() filter: ReportFilterDto) {
    this.send(res, 'members.xlsx', await this.reports.membersWorkbook(filter));
  }

  @Get('subscriptions.xlsx')
  @RequirePermission('reports', 'read')
  async subscriptions(@Res() res: Response, @Query() filter: ReportFilterDto) {
    this.send(
      res,
      'subscriptions.xlsx',
      await this.reports.subscriptionsWorkbook(filter),
    );
  }

  @Get('engagement.xlsx')
  @RequirePermission('reports', 'read')
  async engagement(@Res() res: Response, @Query() filter: ReportFilterDto) {
    this.send(
      res,
      'engagement.xlsx',
      await this.reports.engagementWorkbook(filter),
    );
  }

  @Get('all.xlsx')
  @RequirePermission('reports', 'read')
  async all(@Res() res: Response, @Query() filter: ReportFilterDto) {
    this.send(res, 'all.xlsx', await this.reports.allWorkbook(filter));
  }

  private send(res: Response, filename: string, buf: Buffer) {
    res
      .header('Content-Type', XLSX_TYPE)
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('Content-Length', String(buf.length))
      .send(buf);
  }
}
