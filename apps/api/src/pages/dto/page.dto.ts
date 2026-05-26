import { IsIn, IsObject, IsOptional, IsString, MinLength } from 'class-validator';
import type { PageStatus, PuckDocument } from '@lms/types';

const STATUSES: PageStatus[] = ['DRAFT', 'PUBLISHED'];

export class CreatePageDto {
  @IsString()
  @MinLength(1)
  title!: string;

  // Optional custom slug; otherwise derived from the title in the service.
  @IsOptional()
  @IsString()
  slug?: string;

  // The Puck document. Stored as JSON; any embedded RichText HTML is sanitized
  // in the service before it is persisted. Kept as a loose object here — the
  // concrete block prop shapes live in @lms/puck, not in the API contract.
  @IsOptional()
  @IsObject()
  data?: PuckDocument;

  @IsOptional()
  @IsIn(STATUSES)
  status?: PageStatus;
}

export class UpdatePageDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsObject()
  data?: PuckDocument;

  @IsOptional()
  @IsIn(STATUSES)
  status?: PageStatus;
}
