import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

// Template field layouts arrive as a JSON array matching CertificateFieldLayout
// (@lms/types). They are deep-normalized/clamped server-side (normalizeFields)
// rather than class-validated — the contract is shared with the admin editor
// and the PDF renderer, and clamping beats rejecting for drag-editor output.

export class CreateCertificateTemplateDto {
  @IsString()
  @Length(1, 120)
  name!: string;

  // Must resolve to a local /media/<key> upload (validated + measured in the
  // service so renders never depend on remote URLs).
  @IsString()
  @MaxLength(500)
  artworkUrl!: string;

  @IsArray()
  fields!: unknown[];

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateCertificateTemplateDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  artworkUrl?: string;

  @IsOptional()
  @IsArray()
  fields?: unknown[];

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class ClaimCertificateDto {
  @IsString()
  levelId!: string;

  // "Name on certificate" — required by the service only when the member's
  // profile first/last name is blank. Snapshotted; never written to the profile.
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;
}
