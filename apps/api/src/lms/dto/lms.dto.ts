import { Transform } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsISO4217CurrencyCode,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

// Stripe's hard cap on a Checkout line-item unit_amount (minor units). Bounding
// the one-off course price here turns a pathological amount into a clean 400 at
// save time instead of a Stripe error when a member later clicks Buy.
const MAX_PRICE_MINOR = 99_999_999;

// Normalize a currency to the uppercase ISO-4217 form the validator expects; the
// service lowercases it again for storage / Stripe. Leaves non-strings untouched
// so @IsOptional short-circuits a missing value.
const toCurrencyCode = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class UpdateLessonNoteDto {
  @IsString()
  @MinLength(1)
  originalName!: string;
}

export class CreateCourseDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @IsOptional()
  @IsString()
  coverImageUrl?: string;

  // Every course must belong to at least one class (level): required, non-empty.
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  levelIds!: string[];

  @IsOptional()
  @IsInt()
  order?: number;

  // One-off purchase price (minor units / cents). null or omitted = not
  // individually purchasable. priceCurrency is an ISO-4217 code.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE_MINOR)
  priceAmount?: number | null;

  @IsOptional()
  @Transform(toCurrencyCode)
  @IsISO4217CurrencyCode()
  priceCurrency?: string;

  @IsOptional()
  @IsBoolean()
  priceActive?: boolean;
}

export class UpdateCourseDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @IsOptional()
  @IsString()
  coverImageUrl?: string;

  // When provided, replaces the course's level assignments wholesale. A course
  // must never end up class-less, so an empty array is rejected.
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  levelIds?: string[];

  @IsOptional()
  @IsInt()
  order?: number;

  // One-off purchase price. Send null for priceAmount to CLEAR the price
  // (course reverts to level-gated only); omit to leave it unchanged.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE_MINOR)
  priceAmount?: number | null;

  @IsOptional()
  @Transform(toCurrencyCode)
  @IsISO4217CurrencyCode()
  priceCurrency?: string;

  @IsOptional()
  @IsBoolean()
  priceActive?: boolean;
}

export class CreateLessonDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @IsOptional()
  @IsString()
  videoUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  durationSeconds?: number;

  @IsOptional()
  @IsInt()
  order?: number;
}

export class UpdateLessonDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @IsOptional()
  @IsString()
  videoUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  durationSeconds?: number;

  @IsOptional()
  @IsInt()
  order?: number;
}
