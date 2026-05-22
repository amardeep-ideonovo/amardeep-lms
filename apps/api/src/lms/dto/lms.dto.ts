import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsInt()
  order?: number;
}

export class CreateCourseDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  levelIds?: string[];

  @IsOptional()
  @IsInt()
  order?: number;
}

export class UpdateCourseDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  // When provided, replaces the course's level assignments wholesale.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  levelIds?: string[];

  @IsOptional()
  @IsInt()
  order?: number;
}

export class CreateLessonDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  muxAssetId?: string;

  @IsOptional()
  @IsString()
  videoUrl?: string;

  @IsOptional()
  @IsInt()
  order?: number;
}
