import { IsOptional, IsString, MinLength } from 'class-validator';

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
