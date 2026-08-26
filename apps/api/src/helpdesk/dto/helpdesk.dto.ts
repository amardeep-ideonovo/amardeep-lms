import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import {
  HELPDESK_CATEGORIES,
  HELPDESK_PRIORITIES,
  HELPDESK_STATUSES,
} from "@lms/types";
import type {
  HelpdeskCategory,
  HelpdeskPriority,
  HelpdeskStatus,
} from "@lms/types";

// Member starts (escalates) a conversation.
export class StartConversationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  issue!: string;

  @IsOptional()
  @IsIn(HELPDESK_CATEGORIES)
  category?: HelpdeskCategory;

  // The member's navigation trail (card keys they viewed). Used ONLY to choose
  // what to snapshot — never as data values, which are re-derived server-side.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  breadcrumbs?: string[];
}

export class ReplyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;
}

export class StatEventDto {
  @IsIn(HELPDESK_CATEGORIES)
  category!: HelpdeskCategory;

  @IsIn(["cardView", "resolvedYes", "escalation"])
  event!: "cardView" | "resolvedYes" | "escalation";
}

// ---- admin ----
export class AdminReplyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;

  @IsOptional()
  @IsBoolean()
  internal?: boolean;

  @IsOptional()
  @IsBoolean()
  resolve?: boolean;

  @IsOptional()
  @IsBoolean()
  waitingOnMember?: boolean;
}

export class AssignDto {
  // Absent / empty = unassign; else an Admin.id.
  @IsOptional()
  @IsString()
  @MaxLength(64)
  assigneeAdminId?: string;
}

export class UpdateTicketDto {
  @IsOptional()
  @IsIn(HELPDESK_PRIORITIES)
  priority?: HelpdeskPriority;

  @IsOptional()
  @IsIn(HELPDESK_CATEGORIES)
  category?: HelpdeskCategory;
}

export class AdminListQueryDto {
  @IsOptional()
  @IsIn(HELPDESK_STATUSES)
  status?: HelpdeskStatus;

  @IsOptional()
  @IsIn(HELPDESK_CATEGORIES)
  category?: HelpdeskCategory;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  assignee?: string;

  @IsOptional()
  @IsString()
  unreadOnly?: string; // "true" when set

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  pageSize?: string;
}

// ---- FAQ article authoring (admin) ----
export class ArticleCreateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  body!: string;

  @IsOptional()
  @IsIn(HELPDESK_CATEGORIES)
  category?: HelpdeskCategory;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  keywords?: string[];

  @IsOptional()
  @IsBoolean()
  published?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class ArticleUpdateDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  body?: string;

  @IsOptional()
  @IsIn(HELPDESK_CATEGORIES)
  category?: HelpdeskCategory;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  keywords?: string[];

  @IsOptional()
  @IsBoolean()
  published?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
