import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedPrincipal } from '../auth/jwt-payload.interface';
import { SearchService } from './search.service';

// Global admin search powering the topbar. AdminGuard = any authenticated admin;
// the service itself scopes results to the sections the admin may read.
@Controller('admin/search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @UseGuards(AdminGuard)
  @Get()
  run(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query('q') q?: string,
  ) {
    return this.search.search(principal, q ?? '');
  }
}
