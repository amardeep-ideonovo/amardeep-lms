import { IsString, MinLength } from 'class-validator';

// Self-service account deletion requires the member's current password as a
// second factor (a stolen session alone shouldn't be able to erase everything).
export class DeleteAccountDto {
  @IsString()
  @MinLength(1)
  password!: string;
}
