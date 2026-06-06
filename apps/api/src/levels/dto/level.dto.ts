import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
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

  // Installment plan: bill this many times, then grant lifetime access. Omit for
  // an ongoing subscription.
  @IsOptional()
  @IsInt()
  @Min(1)
  installments?: number;
}

// One "Skills You'll Learn" card on the class landing page.
export class SkillInputDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;
}

export class CreateLevelDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  slug?: string;

  // Show this class as a tile on the member dashboard.
  @IsOptional()
  @IsBoolean()
  published?: boolean;

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

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categoryIds?: string[];

  // ----- MasterClass-style landing-page fields -----
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  trailerUrl?: string;

  @IsOptional()
  @IsString()
  featuredCourseId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SkillInputDto)
  skills?: SkillInputDto[];
}

export class UpdateLevelDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  slug?: string;

  @IsOptional()
  @IsBoolean()
  published?: boolean;

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

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categoryIds?: string[];

  // ----- MasterClass-style landing-page fields -----
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  trailerUrl?: string;

  @IsOptional()
  @IsString()
  featuredCourseId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SkillInputDto)
  skills?: SkillInputDto[];
}

// Admin-only "class" (level) category. Mirrors the blog's category create DTO.
export class CreateLevelCategoryDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsInt()
  order?: number;
}
