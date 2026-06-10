import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type {
  AppColorScheme,
  AppConfig,
  AppThemePalette,
  FooterBottomLink,
  FooterConfig,
  FooterEmail,
  HeaderAudience,
  HeaderConditions,
  HeaderConfig,
  HeaderCta,
  HeaderCtaLink,
  HeaderLayout,
  HeaderPageMode,
  HeaderSection,
  HeaderWidth,
  MenuItemType,
} from '@lms/types';

// Strict, fully-nested validation — the global pipe runs with
// whitelist + forbidNonWhitelisted + transform, so every property the client
// sends must be declared here, and nested objects/arrays need @ValidateNested +
// @Type or they're stripped. Enum/type values are loosely typed and re-sanitized
// in SiteService (the API consumes @lms/types as TYPES only).
const HEX = /^#[0-9a-fA-F]{6}$/;

class HeaderCtaLinkDto implements HeaderCtaLink {
  @IsString() type!: MenuItemType;
  @IsOptional() @IsString() @MaxLength(2000) url?: string | null;
  @IsOptional() @IsString() @MaxLength(80) pageId?: string | null;
  @IsOptional() @IsString() @MaxLength(80) levelId?: string | null;
  @IsOptional() @IsString() @MaxLength(80) courseId?: string | null;
  @IsOptional() @IsString() @MaxLength(80) postId?: string | null;
  @IsOptional() @IsBoolean() openNewTab?: boolean;
}

class HeaderCtaDto implements HeaderCta {
  @IsString() @MaxLength(80) id!: string;
  @IsString() @MaxLength(120) label!: string;
  @Matches(HEX) bgColor!: string;
  @Matches(HEX) textColor!: string;
  @IsInt() @Min(0) @Max(200) paddingX!: number;
  @IsInt() @Min(0) @Max(200) paddingY!: number;
  @IsInt() @Min(0) @Max(100) borderRadius!: number;
  @ValidateNested() @Type(() => HeaderCtaLinkDto) link!: HeaderCtaLinkDto;
}

class HeaderConfigDto implements HeaderConfig {
  @IsString() layout!: HeaderLayout;
  @IsString() width!: HeaderWidth;
  @IsOptional() @IsInt() @Min(320) @Max(4000) maxWidth?: number | null;
  @Matches(HEX) bgColor!: string;
  @IsInt() @Min(0) @Max(200) paddingX!: number;
  @IsInt() @Min(0) @Max(200) paddingY!: number;
  @IsOptional() @IsString() @MaxLength(2000) logoUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(80) menuId?: string | null;
  @Matches(HEX) linkColor!: string;
  @IsOptional() @Matches(HEX) menuActiveColor?: string | null;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HeaderCtaDto)
  ctas!: HeaderCtaDto[];
}

class HeaderConditionsDto implements HeaderConditions {
  @IsString() audience!: HeaderAudience;
  @IsOptional() @IsString() @MaxLength(80) audienceLevelId?: string | null;
  @IsString() pageMode!: HeaderPageMode;
  @IsArray() @IsString({ each: true }) @MaxLength(80, { each: true })
  includePageIds!: string[];
  @IsArray() @IsString({ each: true }) includeSections!: HeaderSection[];
  @IsArray() @IsString({ each: true }) @MaxLength(80, { each: true })
  excludePageIds!: string[];
  @IsArray() @IsString({ each: true }) excludeSections!: HeaderSection[];
}

export class CreateHeaderDto {
  @IsString() @MaxLength(120) name!: string;
}

export class UpdateHeaderDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @ValidateNested() @Type(() => HeaderConfigDto)
  config?: HeaderConfigDto;
  @IsOptional() @ValidateNested() @Type(() => HeaderConditionsDto)
  conditions?: HeaderConditionsDto;
}

export class ReorderHeadersDto {
  @IsArray() @IsString({ each: true }) ids!: string[];
}

// ----- footer (single global config) -----
class FooterEmailDto implements FooterEmail {
  @IsString() @MaxLength(120) heading!: string;
  @IsOptional() @IsString() @MaxLength(400) text?: string | null;
  @IsString() @MaxLength(120) placeholder!: string;
  @IsString() @MaxLength(60) buttonText!: string;
  @IsOptional() @IsString() @MaxLength(80) audienceId?: string | null;
  @IsOptional() @IsString() @MaxLength(200) audienceName?: string | null;
  @IsBoolean() doubleOptIn!: boolean;
  @IsString() @MaxLength(300) successMessage!: string;
}
class FooterBottomLinkDto implements FooterBottomLink {
  @IsString() @MaxLength(80) id!: string;
  @IsString() @MaxLength(80) label!: string;
  @IsString() @MaxLength(2000) url!: string;
}
class FooterConfigDto implements FooterConfig {
  @IsBoolean() enabled!: boolean;
  @Matches(HEX) bgColor!: string;
  @Matches(HEX) textColor!: string;
  @Matches(HEX) headingColor!: string;
  @Matches(HEX) linkColor!: string;
  @IsInt() @Min(0) @Max(200) paddingY!: number;
  @IsOptional() @IsString() @MaxLength(2000) logoUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(300) tagline?: string | null;
  @IsString() @MaxLength(80) menuHeading!: string;
  @IsOptional() @IsString() @MaxLength(80) menuId?: string | null;
  @ValidateNested() @Type(() => FooterEmailDto) email!: FooterEmailDto;
  @IsString() @MaxLength(300) copyright!: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FooterBottomLinkDto)
  bottomLinks!: FooterBottomLinkDto[];
}
export class UpdateFooterDto {
  @ValidateNested() @Type(() => FooterConfigDto) footer!: FooterConfigDto;
}
export class FooterSubscribeDto {
  @IsEmail() email!: string;
}

// ----- mobile app customization (single global config) -----
class AppThemePaletteDto implements AppThemePalette {
  @Matches(HEX) bg!: string;
  @Matches(HEX) surface!: string;
  @Matches(HEX) surfaceMuted!: string;
  @Matches(HEX) border!: string;
  @Matches(HEX) text!: string;
  @Matches(HEX) textMuted!: string;
  @Matches(HEX) primary!: string;
  @Matches(HEX) danger!: string;
}
class AppConfigDto implements AppConfig {
  @IsString() @MaxLength(80) title!: string;
  @IsOptional() @IsString() @MaxLength(200) tagline?: string | null;
  @IsOptional() @IsString() @MaxLength(600) description?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) logoUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) iconUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) splashUrl?: string | null;
  @IsIn(['light', 'dark', 'system']) colorScheme!: AppColorScheme;
  @ValidateNested() @Type(() => AppThemePaletteDto) light!: AppThemePaletteDto;
  @ValidateNested() @Type(() => AppThemePaletteDto) dark!: AppThemePaletteDto;
}
export class UpdateAppConfigDto {
  @ValidateNested() @Type(() => AppConfigDto) appConfig!: AppConfigDto;
}
