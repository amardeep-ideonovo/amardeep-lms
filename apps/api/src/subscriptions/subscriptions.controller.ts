import { Controller, Get, UseGuards } from '@nestjs/common';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { SubscriptionsService } from './subscriptions.service';

// Read-only admin Subscriptions tab. Listing is live from Stripe; managing an
// individual member's plan (pause/resume/cancel) stays on the member billing
// page (BillingController), so there are no mutating routes here.
@UseGuards(PermissionsGuard)
@Controller('admin/subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  @RequirePermission('subscriptions', 'read')
  list() {
    return this.subscriptions.list();
  }
}
