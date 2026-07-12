import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
const CATEGORIES = [
  'BILLING',
  'TECHNICAL',
  'BUG',
  'HOWTO',
  'FEATURE_REQUEST',
  'ACCOUNT',
  'OTHER',
] as const;

export class RaiseTicketDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  subject!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;

  @IsOptional()
  @IsIn(PRIORITIES)
  priority?: (typeof PRIORITIES)[number];

  @IsOptional()
  @IsIn(CATEGORIES)
  category?: (typeof CATEGORIES)[number];
}

export class ReplyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;
}

export class CsatDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
