import { IsOptional, IsString, Matches, MaxLength } from "class-validator";

// Optional query filters for the report exports (GET /admin/reports/*.xlsx). All
// omittable — no filter means "all data". Validated by the global ValidationPipe.
export class ReportFilterDto {
  // Inclusive calendar-day bounds, interpreted as UTC. Strictly YYYY-MM-DD so the
  // service can safely build Date boundaries by string interpolation.
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "from must be YYYY-MM-DD" })
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "to must be YYYY-MM-DD" })
  to?: string;

  // Class/level id to scope the report to (matches a Level.id).
  @IsOptional()
  @IsString()
  levelId?: string;
}

// Filters for the page-scoped Subscriptions export (GET
// /admin/reports/subscriptions-export.xlsx). Mirror the Subscriptions page's
// on-screen controls so a "current view" export matches what's displayed.
// `status` is a free string (raw Stripe statuses plus the derived "paused"), so
// it is intentionally not enumerated — an unknown value simply matches nothing.
export class SubscriptionsExportQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;
}
