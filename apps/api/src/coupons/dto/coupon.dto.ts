import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

// Admin creates a coupon code. percent vs amount is chosen via `discountType`;
// cross-field rules (percent needs percentOff, amount needs amountOff, repeating
// needs durationInMonths) are enforced in CouponsService for clean messages.
export class CreateCouponDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{3,40}$/, {
    message: 'Code must be 3–40 chars: letters, numbers, hyphen or underscore',
  })
  code!: string;

  @IsIn(['percent', 'amount'])
  discountType!: 'percent' | 'amount';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  percentOff?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  amountOff?: number; // minor units (cents)

  @IsOptional()
  @IsString()
  currency?: string;

  @IsIn(['once', 'repeating', 'forever'])
  duration!: 'once' | 'repeating' | 'forever';

  @IsOptional()
  @IsInt()
  @Min(1)
  durationInMonths?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxRedemptions?: number;

  @IsOptional()
  @IsString()
  expiresAt?: string; // ISO date

  @IsOptional()
  @IsString()
  levelId?: string; // restrict to one level's Stripe product
}
