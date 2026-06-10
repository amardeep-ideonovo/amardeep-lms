import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import type { AppConfig } from '@lms/types';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { AppConfigService } from './app-config.service';
import { UpdateAppConfigDto } from './dto/site.dto';

// App customization is its own RBAC section (`appCustomization`). Read/edit only
// — there is nothing to create or delete (it's a singleton).
@UseGuards(PermissionsGuard)
@Controller('admin/app')
export class AdminAppConfigController {
  constructor(private readonly appConfig: AppConfigService) {}

  @Get('config')
  @RequirePermission('appCustomization', 'read')
  get(): Promise<AppConfig> {
    return this.appConfig.read();
  }

  @Put('config')
  @RequirePermission('appCustomization', 'edit')
  put(@Body() dto: UpdateAppConfigDto): Promise<AppConfig> {
    return this.appConfig.write(dto.appConfig as unknown as AppConfig);
  }
}
