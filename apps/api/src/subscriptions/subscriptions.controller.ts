import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/guards/admin.guard';
import { SubscriptionsService } from './subscriptions.service';

// Read-only admin Subscriptions tab. Listing is live from Stripe; managing an
// individual member's plan (pause/resume/cancel) stays on the member billing
// page (BillingController), so there are no mutating routes here.
@UseGuards(AdminGuard)
@Controller('admin/subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  list() {
    return this.subscriptions.list();
  }
}
