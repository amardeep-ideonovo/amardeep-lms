import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { LevelType } from '@lms/types';

export class PriceInputDto {
  @IsIn(['month', 'year'])
  interval!: 'month' | 'year';

  @IsInt()
  @Min(0)
  amount!: number; // minor units (cents)

  @IsOptional()
  @IsString()
  currency?: string;
}

export class CreateLevelDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsIn(['PAID', 'FREE', 'MANUAL'])
  type!: LevelType;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mailchimpTags?: string[];

  @IsOptional()
  @IsString()
  mailchimpAudienceId?: string;

  @IsOptional()
  @IsString()
  mailchimpAudienceName?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PriceInputDto)
  prices?: PriceInputDto[];
}

export class UpdateLevelDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsIn(['PAID', 'FREE', 'MANUAL'])
  type?: LevelType;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mailchimpTags?: string[];

  @IsOptional()
  @IsString()
  mailchimpAudienceId?: string;

  @IsOptional()
  @IsString()
  mailchimpAudienceName?: string;

  // Desired set of offered prices (admin edit form always submits the full
  // list). The service reconciles it against Stripe: Stripe Prices are
  // immutable, so a changed amount becomes a NEW Price plus an archived old one.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PriceInputDto)
  prices?: PriceInputDto[];
}
