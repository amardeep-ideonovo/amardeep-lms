import {
  IsArray,
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import type {
  CreateEmailTemplateInput,
  RenderPreviewInput,
  TestSendInput,
  UpdateEmailTemplateInput,
} from '@lms/types';

// ---------- Email template CRUD ----------
export class CreateEmailTemplateDto implements CreateEmailTemplateInput {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsString()
  @MinLength(1)
  subject!: string;

  @IsString()
  @MinLength(1)
  mjml!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  variables?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;
}

export class UpdateEmailTemplateDto implements UpdateEmailTemplateInput {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  subject?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  mjml?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  variables?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;
}

// ---------- Ad-hoc preview (live editor; no saved row) ----------
export class RenderPreviewDto implements RenderPreviewInput {
  @IsString()
  @MinLength(1)
  subject!: string;

  @IsString()
  @MinLength(1)
  mjml!: string;

  @IsOptional()
  @IsObject()
  vars?: Record<string, unknown>;
}

// ---------- Test send ----------
export class TestSendDto implements TestSendInput {
  @IsEmail()
  to!: string;

  @IsOptional()
  @IsObject()
  vars?: Record<string, unknown>;
}
