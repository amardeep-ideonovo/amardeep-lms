import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import type { LiveAudience, LiveProvider } from '@lms/types';

const PROVIDERS: LiveProvider[] = ['ZOOM', 'GOOGLE_MEET'];
const AUDIENCES: LiveAudience[] = ['ALL_ACTIVE', 'LEVELS'];
// Naive wall-time "YYYY-MM-DDTHH:mm" (what <input type="datetime-local"> emits);
// the SERVER converts this against `timezone` to a UTC instant.
const LOCAL_DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const URL_OPTS = { protocols: ['https'], require_protocol: true };

export class CreateLiveSessionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsIn(PROVIDERS)
  provider!: LiveProvider;

  @IsIn(AUDIENCES)
  audience!: LiveAudience;

  // Required and non-empty only when targeting specific classes.
  @ValidateIf((o) => o.audience === 'LEVELS')
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  levelIds?: string[];

  @IsUrl(URL_OPTS)
  joinUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  password?: string;

  @IsString()
  @Matches(LOCAL_DT, { message: 'startsAtLocal must be "YYYY-MM-DDTHH:mm"' })
  startsAtLocal!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsInt()
  @Min(5)
  @Max(600)
  durationMin!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  joinLeadMin?: number;
}

// Every field optional; the service only touches what's present. Omit joinUrl to
// keep the stored ciphertext; send password: "" to clear a stored passcode.
export class UpdateLiveSessionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsIn(PROVIDERS)
  provider?: LiveProvider;

  @IsOptional()
  @IsIn(AUDIENCES)
  audience?: LiveAudience;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  levelIds?: string[];

  @IsOptional()
  @IsUrl(URL_OPTS)
  joinUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  password?: string;

  @IsOptional()
  @IsString()
  @Matches(LOCAL_DT, { message: 'startsAtLocal must be "YYYY-MM-DDTHH:mm"' })
  startsAtLocal?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(600)
  durationMin?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  joinLeadMin?: number;
}
