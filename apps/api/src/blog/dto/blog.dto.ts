import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import type { PostStatus } from '@lms/types';

const STATUSES: PostStatus[] = ['DRAFT', 'PUBLISHED'];

export class CreatePostDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  excerpt?: string;

  @IsOptional()
  @IsString()
  content?: string; // raw HTML; sanitized in the service before storage

  @IsOptional()
  @IsString()
  coverImageUrl?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categoryIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsIn(STATUSES)
  status?: PostStatus;
}

export class UpdatePostDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @IsOptional()
  @IsString()
  excerpt?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  coverImageUrl?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categoryIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsIn(STATUSES)
  status?: PostStatus;
}

export class CreatePostCategoryDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsInt()
  order?: number;
}
