import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type {
  AutomationInput,
  AutomationTrigger,
  CampaignCadence,
  CampaignInput,
} from '@lms/types';

const CADENCES: CampaignCadence[] = ['ONCE', 'WEEKLY', 'MONTHLY', 'CRON'];
const TRIGGERS: AutomationTrigger[] = [
  'SIGNUP',
  'SUBSCRIPTION_ACTIVE',
  'SUBSCRIPTION_CANCELED',
  'LESSON_COMPLETED',
  'CERTIFICATE_ISSUED',
];

// ---------- Campaigns ----------
// One DTO for create+update: every field is optional and the controller picks
// the right service method. Create-time required fields (name/templateId/
// audienceId) are enforced in CampaignService (a friendlier error than a 400
// validation list, and keeps the same body shape on both verbs).
export class CampaignDto implements CampaignInput {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  templateId?: string;

  @IsOptional()
  @IsString()
  audienceId?: string;

  // null clears a previously-set segment (whole-audience send).
  @IsOptional()
  @IsString()
  segmentId?: string | null;

  @IsOptional()
  @IsIn(CADENCES)
  cadence?: CampaignCadence;

  // ISO timestamp; null clears it. ONCE send time / recurring first run.
  @IsOptional()
  @IsISO8601()
  runAt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  cron?: string | null;
}

// ---------- Automations ----------
export class AutomationDto implements AutomationInput {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsIn(TRIGGERS)
  trigger?: AutomationTrigger;

  @IsOptional()
  @IsString()
  templateId?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  delayMinutes?: number;
}
