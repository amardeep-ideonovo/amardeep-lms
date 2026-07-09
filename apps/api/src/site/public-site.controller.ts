import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type {
  FooterConfig,
  FooterSubscribeResult,
  ResolvedHeader,
} from '@lms/types';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedPrincipal } from '../auth/jwt-payload.interface';
import { SiteService } from './site.service';
import { FooterService } from './footer.service';
import { FooterSubscribeDto } from './dto/site.dto';

// Public header resolution for the web site. Optional auth so audience/level
// rules can be evaluated for the current visitor.
//   ?path=/blog/foo -> the matching header for that path + visitor (client call)
//   no path          -> the site-wide guest default (SSR initial paint, no flash)
@UseGuards(OptionalJwtAuthGuard)
@Controller('site')
export class PublicSiteController {
  constructor(
    private readonly site: SiteService,
    private readonly footer: FooterService,
  ) {}

  @Get('header')
  header(
    @Query('path') path: string | undefined,
    @CurrentUser() principal?: AuthenticatedPrincipal | null,
  ): Promise<ResolvedHeader | null> {
    return path
      ? this.site.matchHeader(path, principal?.sub)
      : this.site.guestDefault();
  }

  @Get('footer')
  footerConfig(): Promise<FooterConfig> {
    return this.footer.readPublic();
  }

  // Per-IP rate limit: unauthenticated newsletter opt-in — cap mail-cannon /
  // email-enumeration abuse (the class-level OptionalJwtAuthGuard still applies).
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('footer/subscribe')
  subscribe(@Body() dto: FooterSubscribeDto): Promise<FooterSubscribeResult> {
    return this.footer.subscribe(dto.email);
  }
}
