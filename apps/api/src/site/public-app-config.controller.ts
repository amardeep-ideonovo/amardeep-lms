import { Controller, Get } from '@nestjs/common';
import type { AppConfig } from '@lms/types';
import { AppConfigService } from './app-config.service';

// Public, unauthenticated: the mobile app fetches this at launch (including its
// logged-out login/signup screens) to theme itself. No per-user variation, so
// no guard — like GET /billing/config.
//
// The version-handshake fields are injected at response time (never stored in
// the AppConfig row): APP_VERSION is stamped into the docker image at build
// (deploy/instance/build-images.sh) and MIN_APP_VERSION is raised deliberately
// when the fleet drops support for old app builds. The app compares these at
// launch and gates gracefully instead of breaking on missing endpoints.
@Controller('app')
export class PublicAppConfigController {
  constructor(private readonly appConfig: AppConfigService) {}

  @Get('config')
  async config(): Promise<AppConfig> {
    const config = await this.appConfig.read();
    // `|| null` (not `?? null`): the Dockerfile sets APP_VERSION="" on an
    // unstamped build, and an empty string must read as "absent" so the app's
    // "no apiVersion = never gate" invariant holds.
    return {
      ...config,
      apiVersion: process.env.APP_VERSION || null,
      minAppVersion: process.env.MIN_APP_VERSION || null,
    };
  }
}
