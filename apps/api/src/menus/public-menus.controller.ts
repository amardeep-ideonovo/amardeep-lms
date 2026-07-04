import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedPrincipal } from '../auth/jwt-payload.interface';
import { MenusService } from './menus.service';

// Public menu rendering for the web site. Optional auth: guests get ALL/GUEST
// items; logged-in members also get AUTHED + LEVEL (for classes they hold).
@UseGuards(OptionalJwtAuthGuard)
@Controller('menus')
export class PublicMenusController {
  constructor(private readonly menus: MenusService) {}

  @Get('location/:location')
  byLocation(
    @Param('location') location: string,
    @CurrentUser() principal?: AuthenticatedPrincipal | null,
  ) {
    return this.menus.resolveByLocation(location, principal?.sub);
  }

  @Get(':id/resolved')
  byId(
    @Param('id') id: string,
    @CurrentUser() principal?: AuthenticatedPrincipal | null,
  ) {
    return this.menus.resolveById(id, principal?.sub);
  }
}
