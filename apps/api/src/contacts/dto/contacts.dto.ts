import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import type {
  ContactFilter,
  ContactSource,
  ContactStatus,
} from '@lms/types';

// Allowed enum values, mirrored from the Prisma enums / @lms/types.
const STATUSES: ContactStatus[] = [
  'SUBSCRIBED',
  'PENDING',
  'UNSUBSCRIBED',
  'CLEANED',
];
const SOURCES: ContactSource[] = [
  'SIGNUP',
  'FORM',
  'FOOTER',
  'IMPORT',
  'MANUAL',
  'ADMIN',
];

// ---------- Audiences ----------
export class CreateAudienceDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateAudienceDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  // null clears the slug; a string sets it.
  @IsOptional()
  @IsString()
  slug?: string | null;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

// ---------- Audience fields (merge tags) ----------
export class UpsertAudienceFieldDto {
  @IsString()
  @MinLength(1)
  tag!: string; // uppercased server-side

  @IsString()
  @MinLength(1)
  label!: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsBoolean()
  required?: boolean;
}

// ---------- Contacts ----------
export class CreateContactDto {
  @IsString()
  @MinLength(1)
  email!: string;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsIn(STATUSES)
  status?: ContactStatus;

  @IsOptional()
  @IsIn(SOURCES)
  source?: ContactSource;
}

export class UpdateContactDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  email?: string;

  @IsOptional()
  @IsString()
  firstName?: string | null;

  @IsOptional()
  @IsString()
  lastName?: string | null;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsIn(STATUSES)
  status?: ContactStatus;
}

// Query params for the paginated contact list. With the global ValidationPipe
// (transform + enableImplicitConversion) the numeric query strings coerce to
// numbers, so page/pageSize validate as ints.
export class ListContactsQueryDto {
  @IsOptional()
  @IsIn(STATUSES)
  status?: ContactStatus;

  @IsOptional()
  @IsString()
  tag?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}

// ---------- Segments ----------
// A saved filter over an audience. `filter` is validated loosely as an object
// here (ContactFilter shape) and normalized in the service.
export class CreateSegmentDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsObject()
  filter!: ContactFilter;
}

export class UpdateSegmentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsObject()
  filter?: ContactFilter;
}
