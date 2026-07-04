import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type {
  ChatFieldType,
  ChatListItemStatus,
  ChatWorkflowTrigger,
} from '@lms/types';

// Allowed enum values, mirrored from the Prisma enum / @lms/types.
const LIST_ITEM_STATUSES: ChatListItemStatus[] = [
  'TODO',
  'IN_PROGRESS',
  'DONE',
];

// Mirrored from the Prisma `ChatWorkflowTrigger` enum / @lms/types union.
const WORKFLOW_TRIGGERS: ChatWorkflowTrigger[] = [
  'ITEM_CREATED',
  'ITEM_ASSIGNED',
  'ITEM_UPDATED',
];

// Mirrored from the Prisma `ChatFieldType` enum / @lms/types union.
const CHAT_FIELD_TYPES: ChatFieldType[] = [
  'TEXT',
  'LONG_TEXT',
  'SELECT',
  'MULTI_SELECT',
  'PERSON',
  'MULTI_PERSON',
  'DATE',
  'URL',
  'NUMBER',
  'CHECKBOX',
  'SECRET',
];

// ---------- Channels ----------
export class CreateChannelDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  topic?: string;

  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;
}

export class UpdateChannelDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  // null clears the topic; a string sets it.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  topic?: string | null;

  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}

// ---------- Direct messages (DMs) ----------
// `adminIds` is the OTHER participant(s) (the actor is added server-side). The
// final member set must be >=2 distinct admins (enforced in DmsService).
export class OpenDmDto {
  @IsArray()
  @IsString({ each: true })
  adminIds!: string[];
}

// ---------- Messages ----------
export class SendMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  body!: string;

  @IsOptional()
  @IsString()
  parentMessageId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mentionedAdminIds?: string[];
}

export class EditMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  body!: string;
}

export class ReactionToggleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  emoji!: string;
}

export class MarkReadDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  seq?: number;
}

// Query params for the message-history (catch-up) endpoint. With the global
// ValidationPipe (transform + enableImplicitConversion) the numeric query
// strings coerce to numbers.
export class ListMessagesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  afterSeq?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

// ---------- Lists (task boards) ----------
export class ListListsQueryDto {
  @IsOptional()
  @IsString()
  channelId?: string;
}

export class CreateListDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  channelId?: string;
}

export class CreateListItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title!: string;

  @IsOptional()
  @IsIn(LIST_ITEM_STATUSES)
  status?: ChatListItemStatus;

  @IsOptional()
  @IsString()
  assigneeAdminId?: string;

  @IsOptional()
  @IsISO8601()
  dueDate?: string;

  // Optional custom-field values (fieldId -> value); validated against the
  // list's fields in the service, same rules as the values PATCH.
  @IsOptional()
  @IsObject()
  values?: Record<string, unknown>;
}

export class UpdateListItemDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title?: string;

  @IsOptional()
  @IsIn(LIST_ITEM_STATUSES)
  status?: ChatListItemStatus;

  // null unassigns; a string sets the assignee.
  @IsOptional()
  @IsString()
  assigneeAdminId?: string | null;

  // null clears the due date; an ISO string sets it.
  @IsOptional()
  @IsISO8601()
  dueDate?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  position?: number;
}

export class MessageToTaskDto {
  @IsString()
  @MinLength(1)
  listId!: string;
}

// ---------- List custom fields (Slack-Lists columns) ----------
// A SELECT/MULTI_SELECT choice. `id` is optional on input — the service
// generates a stable id for any option that omits one.
export class ListFieldOptionDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  id?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  color?: string | null;
}

export class CreateListFieldDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsIn(CHAT_FIELD_TYPES)
  type?: ChatFieldType;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ListFieldOptionDto)
  options?: ListFieldOptionDto[];

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  position?: number;
}

export class UpdateListFieldDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsIn(CHAT_FIELD_TYPES)
  type?: ChatFieldType;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ListFieldOptionDto)
  options?: ListFieldOptionDto[];

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  position?: number;
}

export class ReorderListFieldsDto {
  @IsArray()
  @IsString({ each: true })
  orderedFieldIds!: string[];
}

// ---------- List item custom-field values ----------
export class UpdateListItemValuesDto {
  // Raw map of fieldId -> value. Each value is validated against its field's
  // type in the service (the shape is type-dependent, so no per-key validator).
  @IsObject()
  values!: Record<string, unknown>;
}

// ---------- Per-item comments (the 💬 thread) ----------
export class CreateListItemCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  body!: string;
}

export class UpdateListItemCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  body!: string;
}

// ---------- Workflows (auto-post a list event into a channel) ----------
export class ListWorkflowsQueryDto {
  @IsOptional()
  @IsString()
  listId?: string;
}

// The workflow `config` blob. Each key is optional; unknown keys are stripped by
// the global ValidationPipe (whitelist). The service re-reads it defensively too.
export class WorkflowConfigDto {
  @IsOptional()
  @IsString()
  assigneeFieldId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  template?: string;

  @IsOptional()
  @IsBoolean()
  includeCard?: boolean;
}

export class CreateWorkflowDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(1)
  listId!: string;

  // null/omitted => post to the list's own channel.
  @IsOptional()
  @IsString()
  channelId?: string | null;

  @IsIn(WORKFLOW_TRIGGERS)
  trigger!: ChatWorkflowTrigger;

  @IsOptional()
  @ValidateNested()
  @Type(() => WorkflowConfigDto)
  config?: WorkflowConfigDto;
}

export class UpdateWorkflowDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  // null clears the override (back to the list's channel); a string sets it.
  @IsOptional()
  @IsString()
  channelId?: string | null;

  @IsOptional()
  @IsIn(WORKFLOW_TRIGGERS)
  trigger?: ChatWorkflowTrigger;

  @IsOptional()
  @ValidateNested()
  @Type(() => WorkflowConfigDto)
  config?: WorkflowConfigDto;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

// ---------- Canvas docs (rich-text channel tabs — the "Web SOP" tab) ----------
// `content` is editor HTML, sanitized server-side in CanvasService on write.
export class CreateCanvasDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200_000)
  content?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  position?: number;
}

export class UpdateCanvasDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200_000)
  content?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  position?: number;
}
