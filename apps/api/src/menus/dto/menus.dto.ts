import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type {
  MenuItemType,
  MenuItemVisibility,
  MenuLocation,
} from '@lms/types';

// Enums/targets are loosely validated here and sanitized in MenusService (the
// API consumes @lms/types as TYPES only, so the canonical const arrays live
// there and the service hardcodes the allowed values — same pattern as RBAC).

export class CreateMenuDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  location?: MenuLocation | null;
}

export class UpdateMenuDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  // null clears the assignment; a value is validated against known locations.
  @IsOptional()
  location?: MenuLocation | null;
}

export class CreateMenuItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label!: string;

  @IsString()
  type!: MenuItemType;

  @IsOptional() url?: string | null;
  @IsOptional() pageId?: string | null;
  @IsOptional() levelId?: string | null;
  @IsOptional() courseId?: string | null;
  @IsOptional() postId?: string | null;

  @IsOptional() @IsBoolean() openNewTab?: boolean;
  @IsOptional() visibility?: MenuItemVisibility;
  @IsOptional() visibilityLevelId?: string | null;
  @IsOptional() @IsString() parentId?: string | null;
}

export class UpdateMenuItemDto {
  @IsOptional() @IsString() @MaxLength(200) label?: string;
  @IsOptional() @IsString() type?: MenuItemType;
  @IsOptional() url?: string | null;
  @IsOptional() pageId?: string | null;
  @IsOptional() levelId?: string | null;
  @IsOptional() courseId?: string | null;
  @IsOptional() postId?: string | null;
  @IsOptional() @IsBoolean() openNewTab?: boolean;
  @IsOptional() visibility?: MenuItemVisibility;
  @IsOptional() visibilityLevelId?: string | null;
}

export class ReorderNodeDto {
  @IsString() id!: string;
  @IsOptional() @IsString() parentId?: string | null;
  @IsInt() order!: number;
}

export class ReorderMenuItemsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReorderNodeDto)
  items!: ReorderNodeDto[];
}
