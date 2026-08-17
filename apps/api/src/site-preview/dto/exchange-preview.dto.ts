import { IsString, MaxLength } from "class-validator";

// Public exchange input: the short-lived handoff token minted by
// POST /admin/site-preview. Length-capped like the reset-token verify path.
export class ExchangePreviewDto {
  @IsString()
  @MaxLength(512)
  handoff!: string;
}
