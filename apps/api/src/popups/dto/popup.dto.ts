import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import type {
  PopupAnimation,
  PopupEventType,
  PopupFrequency,
  PopupPageMode,
  PopupPosition,
  PopupStatus,
  PopupTrigger,
  PuckDocument,
} from '@lms/types';

const EVENT_TYPES: PopupEventType[] = ['view', 'click', 'dismiss'];

// Public analytics ping (fire-and-forget from the renderer).
export class PopupEventDto {
  @IsIn(EVENT_TYPES)
  type!: PopupEventType;
}

const STATUSES: PopupStatus[] = ['ACTIVE', 'INACTIVE'];
const POSITIONS: PopupPosition[] = [
  'CENTER',
  'TOP',
  'BOTTOM',
  'TOP_LEFT',
  'TOP_RIGHT',
  'BOTTOM_LEFT',
  'BOTTOM_RIGHT',
];
const PAGE_MODES: PopupPageMode[] = ['NONE', 'ALL', 'INCLUDE', 'EXCLUDE'];
const TRIGGERS: PopupTrigger[] = ['IMMEDIATE', 'DELAY', 'SCROLL', 'EXIT_INTENT'];
const FREQUENCIES: PopupFrequency[] = [
  'EVERY_VISIT',
  'ONCE_PER_SESSION',
  'ONCE_PER_DAYS',
  'ONCE',
];
const ANIMATIONS: PopupAnimation[] = ['NONE', 'FADE', 'SLIDE_UP', 'ZOOM'];

export class CreatePopupDto {
  @IsString()
  @MinLength(1)
  name!: string;

  // The Puck document (same shape as a Page). Sanitized in the service before
  // it is persisted — kept a loose object here (block prop shapes live in
  // @lms/puck, not in the API contract).
  @IsOptional()
  @IsObject()
  data?: PuckDocument;

  @IsOptional()
  @IsIn(STATUSES)
  status?: PopupStatus;

  // ----- presentation -----
  @IsOptional()
  @IsString()
  width?: string;

  @IsOptional()
  @IsString()
  height?: string;

  // Any CSS color (hex/rgb/named) — kept as a free string, not @IsHexColor.
  @IsOptional()
  @IsString()
  background?: string;

  @IsOptional()
  @IsIn(POSITIONS)
  position?: PopupPosition;

  @IsOptional()
  @IsString()
  borderColor?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(200)
  borderRadius?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(200)
  padding?: number;

  // ----- visibility / targeting -----
  @IsOptional()
  @IsBoolean()
  showOnDashboard?: boolean;

  @IsOptional()
  @IsBoolean()
  showOnClasses?: boolean;

  @IsOptional()
  @IsBoolean()
  showOnCourses?: boolean;

  @IsOptional()
  @IsBoolean()
  showOnLessons?: boolean;

  @IsOptional()
  @IsIn(PAGE_MODES)
  pageMode?: PopupPageMode;

  // Plain string[] (page ids). Simple scalar array — no @ValidateNested needed.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  pageIds?: string[];

  // ----- behaviour -----
  @IsOptional()
  @IsIn(TRIGGERS)
  trigger?: PopupTrigger;

  // DELAY: seconds (0-600); SCROLL: percent (0-100). Validated loosely as the
  // shared upper bound; the renderer clamps per-trigger.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(600)
  triggerValue?: number;

  @IsOptional()
  @IsIn(FREQUENCIES)
  frequency?: PopupFrequency;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  frequencyDays?: number;

  @IsOptional()
  @IsBoolean()
  closeOnOverlay?: boolean;

  @IsOptional()
  @IsIn(ANIMATIONS)
  animation?: PopupAnimation;
}

// Update mirrors create with everything optional (name included), matching the
// Pages DTO style. Explicit class (not PartialType) so the whitelist stays tight.
export class UpdatePopupDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsObject()
  data?: PuckDocument;

  @IsOptional()
  @IsIn(STATUSES)
  status?: PopupStatus;

  @IsOptional()
  @IsString()
  width?: string;

  @IsOptional()
  @IsString()
  height?: string;

  @IsOptional()
  @IsString()
  background?: string;

  @IsOptional()
  @IsIn(POSITIONS)
  position?: PopupPosition;

  @IsOptional()
  @IsString()
  borderColor?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(200)
  borderRadius?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(200)
  padding?: number;

  @IsOptional()
  @IsBoolean()
  showOnDashboard?: boolean;

  @IsOptional()
  @IsBoolean()
  showOnClasses?: boolean;

  @IsOptional()
  @IsBoolean()
  showOnCourses?: boolean;

  @IsOptional()
  @IsBoolean()
  showOnLessons?: boolean;

  @IsOptional()
  @IsIn(PAGE_MODES)
  pageMode?: PopupPageMode;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  pageIds?: string[];

  // ----- behaviour -----
  @IsOptional()
  @IsIn(TRIGGERS)
  trigger?: PopupTrigger;

  // DELAY: seconds (0-600); SCROLL: percent (0-100). Validated loosely as the
  // shared upper bound; the renderer clamps per-trigger.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(600)
  triggerValue?: number;

  @IsOptional()
  @IsIn(FREQUENCIES)
  frequency?: PopupFrequency;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  frequencyDays?: number;

  @IsOptional()
  @IsBoolean()
  closeOnOverlay?: boolean;

  @IsOptional()
  @IsIn(ANIMATIONS)
  animation?: PopupAnimation;
}
