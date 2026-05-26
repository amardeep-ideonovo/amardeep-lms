import {
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { FormStatus } from '@lms/types';

const STATUSES: FormStatus[] = ['ACTIVE', 'INACTIVE'];

// A nested DTO is REQUIRED for the fields array: with the global ValidationPipe
// (transform + enableImplicitConversion), an array-of-objects property without
// @Type/@ValidateNested gets each element coerced to [] (data loss). Declaring
// the element class makes class-transformer build real objects and keeps the
// whitelisted properties.
export class FormFieldDto {
  @IsString()
  id!: string;

  @IsString()
  type!: string; // FormFieldType (text | email | textarea | …)

  @IsString()
  label!: string;

  @IsString()
  name!: string;

  @IsBoolean()
  required!: boolean;

  @IsOptional()
  @IsString()
  placeholder?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  @IsOptional()
  @IsString()
  mergeTag?: string;
}

export class CreateFormDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FormFieldDto)
  fields?: FormFieldDto[];

  @IsOptional()
  @IsString()
  mailchimpAudienceId?: string;

  @IsOptional()
  @IsString()
  mailchimpAudienceName?: string;

  @IsOptional()
  @IsBoolean()
  doubleOptIn?: boolean;

  @IsOptional()
  @IsBoolean()
  updateExisting?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  successMessage?: string;

  @IsOptional()
  @IsString()
  redirectUrl?: string;

  @IsOptional()
  @IsIn(STATUSES)
  status?: FormStatus;
}

export class UpdateFormDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FormFieldDto)
  fields?: FormFieldDto[];

  @IsOptional()
  @IsString()
  mailchimpAudienceId?: string;

  @IsOptional()
  @IsString()
  mailchimpAudienceName?: string;

  @IsOptional()
  @IsBoolean()
  doubleOptIn?: boolean;

  @IsOptional()
  @IsBoolean()
  updateExisting?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  successMessage?: string;

  @IsOptional()
  @IsString()
  redirectUrl?: string;

  @IsOptional()
  @IsIn(STATUSES)
  status?: FormStatus;
}

export class FormSubmitDto {
  // Map of field name -> submitted value. Validated against the form's field
  // definitions (required / email) in the service.
  @IsObject()
  values!: Record<string, unknown>;
}
