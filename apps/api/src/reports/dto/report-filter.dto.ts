import { IsOptional, IsString, Matches } from 'class-validator';

// Optional query filters for the report exports (GET /admin/reports/*.xlsx). All
// omittable — no filter means "all data". Validated by the global ValidationPipe.
export class ReportFilterDto {
  // Inclusive calendar-day bounds, interpreted as UTC. Strictly YYYY-MM-DD so the
  // service can safely build Date boundaries by string interpolation.
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be YYYY-MM-DD' })
  to?: string;

  // Class/level id to scope the report to (matches a Level.id).
  @IsOptional()
  @IsString()
  levelId?: string;
}
