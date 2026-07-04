import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class CheckoutDto {
  @IsString()
  @MinLength(1)
  priceId!: string;
}

// Start an embedded (Stripe Elements) subscription for a provisioned price.
export class SubscribeDto {
  @IsString()
  @MinLength(1)
  priceId!: string;

  @IsOptional()
  @IsString()
  couponCode?: string;
}

// Validate a coupon / promotion code against a price (discount preview).
export class CouponValidateDto {
  @IsString()
  @MinLength(1)
  code!: string;

  @IsString()
  @MinLength(1)
  priceId!: string;
}

// Admin cancel of a member's subscription: end access now or at period end.
export class CancelSubDto {
  @IsIn(['immediate', 'period_end'])
  mode!: 'immediate' | 'period_end';
}

// Start a one-off (one-time) course purchase — Stripe mode=payment checkout.
export class CourseCheckoutDto {
  @IsString()
  @MinLength(1)
  courseId!: string;
}

// Confirm a one-off course purchase inline after the Stripe redirect (grants
// immediately without waiting on the webhook).
export class CoursePurchaseConfirmDto {
  @IsString()
  @MinLength(1)
  sessionId!: string;
}

// PayPal checkout step 1: lazily provision the billing plan for a price.
export class PayPalPrepareDto {
  // Local Price.id (preferred) or a stripePriceId — the server resolves both.
  @IsString()
  @MinLength(1)
  priceId!: string;
}

// PayPal checkout step 2: verify the approved subscription and grant access.
export class PayPalActivateDto {
  @IsString()
  @MinLength(1)
  subscriptionId!: string;
}
