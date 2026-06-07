import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedPrincipal } from '../auth/jwt-payload.interface';
import { BillingService } from './billing.service';
import {
  CancelSubDto,
  CheckoutDto,
  CouponValidateDto,
  SubscribeDto,
} from './dto/billing.dto';

@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @UseGuards(JwtAuthGuard)
  @Post('checkout')
  checkout(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: CheckoutDto,
  ) {
    return this.billing.createCheckout(principal.sub, dto.priceId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('portal')
  portal(@CurrentUser() principal: AuthenticatedPrincipal) {
    return this.billing.createPortal(principal.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Get('subscriptions')
  mySubscriptions(@CurrentUser() principal: AuthenticatedPrincipal) {
    return this.billing.mySubscriptions(principal.sub);
  }

  // Public: the checkout page reads this to mount Stripe Elements (publishable
  // key only — safe to expose; null when Stripe isn't configured).
  @Get('config')
  config() {
    return this.billing.getConfig();
  }

  @UseGuards(JwtAuthGuard)
  @Post('subscribe')
  subscribe(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: SubscribeDto,
  ) {
    return this.billing.subscribe(principal.sub, dto);
  }

  // Called by the checkout right after a successful payment to reconcile the
  // new subscription inline (grant + mirror + admin notification) without
  // waiting on the Stripe webhook.
  @UseGuards(JwtAuthGuard)
  @Post('sync')
  sync(@CurrentUser() principal: AuthenticatedPrincipal) {
    return this.billing.syncMySubscriptions(principal.sub);
  }

  // Member self-service cancellation of their OWN subscription — always at period
  // end (keeps paid-through access, stops renewal). Ownership enforced in service.
  @UseGuards(JwtAuthGuard)
  @Post('subscriptions/:subId/cancel')
  cancelMySubscription(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('subId') subId: string,
  ) {
    return this.billing.cancelMyMembership(principal.sub, subId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('coupon/validate')
  validateCoupon(@Body() dto: CouponValidateDto) {
    return this.billing.validateCoupon(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('subscription-details')
  subscriptionDetails(@CurrentUser() principal: AuthenticatedPrincipal) {
    return this.billing.getMySubscriptionDetails(principal.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Get('invoices')
  invoices(@CurrentUser() principal: AuthenticatedPrincipal) {
    return this.billing.getMyInvoices(principal.sub);
  }

  // Admin: per-member billing detail + one-click pause / resume / cancel.
  @UseGuards(AdminGuard)
  @Get('members/:id')
  memberBilling(@Param('id') id: string) {
    return this.billing.getMemberBilling(id);
  }

  @UseGuards(AdminGuard)
  @Post('members/:id/subscriptions/:subId/pause')
  pauseSub(@Param('id') id: string, @Param('subId') subId: string) {
    return this.billing.pauseSub(id, subId);
  }

  @UseGuards(AdminGuard)
  @Post('members/:id/subscriptions/:subId/resume')
  resumeSub(@Param('id') id: string, @Param('subId') subId: string) {
    return this.billing.resumeSub(id, subId);
  }

  @UseGuards(AdminGuard)
  @Post('members/:id/subscriptions/:subId/cancel')
  cancelSub(
    @Param('id') id: string,
    @Param('subId') subId: string,
    @Body() dto: CancelSubDto,
  ) {
    return this.billing.cancelSub(id, subId, dto.mode);
  }

  // Public (Stripe-signed). Raw body is provided by the express.raw() parser
  // registered for this exact path in main.ts.
  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Req() req: Request,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!signature) throw new BadRequestException('Missing stripe-signature');
    const rawBody = req.body as Buffer;
    if (!Buffer.isBuffer(rawBody)) {
      throw new BadRequestException('Expected raw body for webhook');
    }
    await this.billing.handleWebhook(rawBody, signature);
    return { received: true };
  }
}
