import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AppColorScheme, AppConfig, AppThemePalette } from '@lms/types';
import { PrismaService } from '../prisma/prisma.service';

const HEX = /^#[0-9a-fA-F]{6}$/;
const SCHEMES: AppColorScheme[] = ['light', 'dark', 'system'];

// Defaults mirror the member WEBSITE's theme (apps/web/app/globals.css and its
// cinematic dark scopes), so web, app, and admin preview agree out of the box.
// MUST stay in sync with apps/mobile/src/theme.ts (the offline fallback).
const DARK: AppThemePalette = {
  bg: '#0b0b0d',
  surface: '#16161b',
  surfaceMuted: '#1c1c22',
  border: '#2d2d32',
  text: '#f4f4f6',
  textMuted: '#8a8a95',
  primary: '#6366f1',
  danger: '#ef4444',
};
const LIGHT: AppThemePalette = {
  bg: '#f6f7f9',
  surface: '#ffffff',
  surfaceMuted: '#eef0f4',
  border: '#e4e7ec',
  text: '#101828',
  textMuted: '#667085',
  primary: '#4f46e5',
  danger: '#d92d20',
};
const DEFAULT_APP_CONFIG: AppConfig = {
  title: 'LMS',
  tagline: null,
  description: null,
  logoUrl: null,
  iconUrl: null,
  splashUrl: null,
  colorScheme: 'system',
  light: LIGHT,
  dark: DARK,
};

// Single global mobile-app branding, mirroring FooterService: a singleton row,
// default-merged + sanitized on BOTH read and write so a hand-edited DB row can
// never push a bad color/value into the native app. The API consumes @lms/types
// as TYPES only, so values are re-validated here regardless of the DTO.
@Injectable()
export class AppConfigService {
  constructor(private readonly prisma: PrismaService) {}

  private color(v: unknown, fb: string): string {
    return typeof v === 'string' && HEX.test(v) ? v : fb;
  }
  private str(v: unknown, max: number, fb = ''): string {
    return typeof v === 'string' ? v.slice(0, max) : fb;
  }
  private strOrNull(v: unknown, max: number): string | null {
    return typeof v === 'string' && v ? v.slice(0, max) : null;
  }
  private palette(raw: any, fb: AppThemePalette): AppThemePalette {
    const r = raw && typeof raw === 'object' ? raw : {};
    return {
      bg: this.color(r.bg, fb.bg),
      surface: this.color(r.surface, fb.surface),
      surfaceMuted: this.color(r.surfaceMuted, fb.surfaceMuted),
      border: this.color(r.border, fb.border),
      text: this.color(r.text, fb.text),
      textMuted: this.color(r.textMuted, fb.textMuted),
      primary: this.color(r.primary, fb.primary),
      danger: this.color(r.danger, fb.danger),
    };
  }

  private sanitize(raw: any): AppConfig {
    const r = raw && typeof raw === 'object' ? raw : {};
    const scheme = SCHEMES.includes(r.colorScheme)
      ? (r.colorScheme as AppColorScheme)
      : DEFAULT_APP_CONFIG.colorScheme;
    return {
      title:
        this.str(r.title, 80, DEFAULT_APP_CONFIG.title) ||
        DEFAULT_APP_CONFIG.title,
      tagline: this.strOrNull(r.tagline, 200),
      description: this.strOrNull(r.description, 600),
      logoUrl: this.strOrNull(r.logoUrl, 2000),
      iconUrl: this.strOrNull(r.iconUrl, 2000),
      splashUrl: this.strOrNull(r.splashUrl, 2000),
      colorScheme: scheme,
      light: this.palette(r.light, LIGHT),
      dark: this.palette(r.dark, DARK),
    };
  }

  /** Default-merged + sanitized. Same shape for admin and public (no secrets). */
  async read(): Promise<AppConfig> {
    const row = await this.prisma.appConfig.findUnique({
      where: { id: 'singleton' },
    });
    return this.sanitize(row?.config);
  }

  async write(cfg: AppConfig): Promise<AppConfig> {
    const clean = this.sanitize(cfg);
    await this.prisma.appConfig.upsert({
      where: { id: 'singleton' },
      create: {
        id: 'singleton',
        config: clean as unknown as Prisma.InputJsonValue,
      },
      update: { config: clean as unknown as Prisma.InputJsonValue },
    });
    return clean;
  }
}
