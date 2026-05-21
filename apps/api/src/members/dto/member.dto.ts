import { IsString, MinLength } from 'class-validator';

export class AddMemberLevelDto {
  @IsString()
  @MinLength(1)
  levelId!: string;
}
