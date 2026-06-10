import { Controller, Get } from '@nestjs/common';
import type { AppConfig } from '@lms/types';
import { AppConfigService } from './app-config.service';

// Public, unauthenticated: the mobile app fetches this at launch (including its
// logged-out login/signup screens) to theme itself. No per-user variation, so
// no guard — like GET /billing/config.
@Controller('app')
export class PublicAppConfigController {
  constructor(private readonly appConfig: AppConfigService) {}

  @Get('config')
  config(): Promise<AppConfig> {
    return this.appConfig.read();
  }
}
