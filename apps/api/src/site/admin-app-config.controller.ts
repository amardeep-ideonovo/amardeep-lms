import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import type { AppConfig, AppWhiteLabelStatus } from '@lms/types';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { WhiteLabelStatusService } from '../control-plane/white-label-status.service';
import { AppConfigService } from './app-config.service';
import { UpdateAppConfigDto } from './dto/site.dto';

// App customization is its own RBAC section (`appCustomization`). Read/edit only
// — there is nothing to create or delete (it's a singleton).
@UseGuards(PermissionsGuard)
@Controller('admin/app')
export class AdminAppConfigController {
  constructor(
    private readonly appConfig: AppConfigService,
    private readonly whiteLabelStatus: WhiteLabelStatusService,
  ) {}

  @Get('config')
  @RequirePermission('appCustomization', 'read')
  get(): Promise<AppConfig> {
    return this.appConfig.read();
  }

  // This instance's app track, pulled (and cached) from the licensing control
  // plane. Drives the icon/splash gate in the admin UI; appMode null = unknown
  // (no plane / unreachable) and the UI fails open with a note.
  @Get('white-label')
  @RequirePermission('appCustomization', 'read')
  whiteLabel(): Promise<AppWhiteLabelStatus> {
    return this.whiteLabelStatus.status();
  }

  @Put('config')
  @RequirePermission('appCustomization', 'edit')
  put(@Body() dto: UpdateAppConfigDto): Promise<AppConfig> {
    return this.appConfig.write(dto.appConfig as unknown as AppConfig);
  }
}
