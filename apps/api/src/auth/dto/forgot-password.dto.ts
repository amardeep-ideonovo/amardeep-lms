import { IsEmail } from 'class-validator';

// Body shape for POST /auth/forgot-password. Mirrors ForgotPasswordInput in
// @lms/types. The endpoint answers { ok: true } no matter what, so the DTO
// only guards shape (a syntactically valid email), never existence.
export class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}
