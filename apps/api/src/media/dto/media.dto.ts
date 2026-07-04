import { IsOptional, IsString, MaxLength } from 'class-validator';

// Editable metadata fields (the WordPress-style attachment details panel).
export class UpdateMediaDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  altText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  caption?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;
}
