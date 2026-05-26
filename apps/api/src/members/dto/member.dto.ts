import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class AddMemberLevelDto {
  @IsString()
  @MinLength(1)
  levelId!: string;
}

// Admin-editable profile fields. All optional; an empty string clears the
// field (handled in the service), an absent field leaves it unchanged.
export class UpdateMemberDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;
}
