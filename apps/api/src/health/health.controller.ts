import { Controller, Get } from '@nestjs/common';

// Public liveness endpoint for platform health checks (Render/Railway/Fly/etc).
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok', uptime: process.uptime() };
  }
}
