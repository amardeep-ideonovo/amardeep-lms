import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedPrincipal } from '../auth/jwt-payload.interface';
import { BillingService } from './billing.service';
import { CheckoutDto } from './dto/billing.dto';

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
