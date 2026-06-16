import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  FooterBottomLink,
  FooterConfig,
  FooterEmail,
  FooterSubscribeResult,
} from '@lms/types';
import { PrismaService } from '../prisma/prisma.service';
import { ContactsService } from '../contacts/contacts.service';

const HEX = /^#[0-9a-fA-F]{6}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Defaults render a sensible dark footer; `enabled: false` keeps the footer off
// until the admin turns it on (so an unconfigured site grows no footer).
const DEFAULT_FOOTER: FooterConfig = {
  enabled: false,
  bgColor: '#0f172a',
  textColor: '#cbd5e1',
  headingColor: '#ffffff',
  linkColor: '#cbd5e1',
  paddingY: 48,
  logoUrl: null,
  tagline: null,
  menuHeading: 'Links',
  menuId: null,
  email: {
    heading: 'Newsletter',
    text: 'Get the latest updates in your inbox.',
    placeholder: 'you@email.com',
    buttonText: 'Subscribe',
    audienceId: null,
    audienceName: null,
    doubleOptIn: false,
    successMessage: "Thanks! You're subscribed.",
  },
  copyright: '© {year} LMS. All rights reserved.',
  bottomLinks: [],
};

@Injectable()
export class FooterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: ContactsService,
  ) {}

  // --- sanitizers (also re-applied on read, so a hand-edited row can't inject
  // bad CSS/values that reach the browser) ---
  private clampInt(v: unknown, min: number, max: number, fb: number): number {
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fb;
    return Math.min(max, Math.max(min, n));
  }
  private color(v: unknown, fb: string): string {
    return typeof v === 'string' && HEX.test(v) ? v : fb;
  }
  private str(v: unknown, max: number, fb = ''): string {
    return typeof v === 'string' ? v.slice(0, max) : fb;
  }
  private strOrNull(v: unknown, max: number): string | null {
    return typeof v === 'string' && v ? v.slice(0, max) : null;
  }

  private sanitizeEmail(raw: any): FooterEmail {
    const r = raw && typeof raw === 'object' ? raw : {};
    return {
      heading: this.str(r.heading, 120, DEFAULT_FOOTER.email.heading),
      text: this.strOrNull(r.text, 400),
      placeholder: this.str(
        r.placeholder,
        120,
        DEFAULT_FOOTER.email.placeholder,
      ),
      buttonText: this.str(r.buttonText, 60, DEFAULT_FOOTER.email.buttonText),
      audienceId: this.strOrNull(r.audienceId, 80),
      audienceName: this.strOrNull(r.audienceName, 200),
      doubleOptIn: !!r.doubleOptIn,
      successMessage: this.str(
        r.successMessage,
        300,
        DEFAULT_FOOTER.email.successMessage,
      ),
    };
  }

  private sanitizeLink(raw: any): FooterBottomLink | null {
    if (!raw || typeof raw !== 'object') return null;
    const id = this.strOrNull(raw.id, 80);
    const label = this.str(raw.label, 80);
    const url = this.str(raw.url, 2000);
    if (!id || !label || !url) return null;
    return { id, label, url };
  }

  private sanitize(raw: any): FooterConfig {
    const r = raw && typeof raw === 'object' ? raw : {};
    return {
      enabled: !!r.enabled,
      bgColor: this.color(r.bgColor, DEFAULT_FOOTER.bgColor),
      textColor: this.color(r.textColor, DEFAULT_FOOTER.textColor),
      headingColor: this.color(r.headingColor, DEFAULT_FOOTER.headingColor),
      linkColor: this.color(r.linkColor, DEFAULT_FOOTER.linkColor),
      paddingY: this.clampInt(r.paddingY, 0, 200, DEFAULT_FOOTER.paddingY),
      logoUrl: this.strOrNull(r.logoUrl, 2000),
      tagline: this.strOrNull(r.tagline, 300),
      menuHeading: this.str(r.menuHeading, 80, DEFAULT_FOOTER.menuHeading),
      menuId: this.strOrNull(r.menuId, 80),
      email: this.sanitizeEmail(r.email),
      copyright: this.str(r.copyright, 300, DEFAULT_FOOTER.copyright),
      bottomLinks: Array.isArray(r.bottomLinks)
        ? r.bottomLinks
            .map((l: unknown) => this.sanitizeLink(l))
            .filter(
              (l: FooterBottomLink | null): l is FooterBottomLink => l !== null,
            )
            .slice(0, 12)
        : [],
    };
  }

  /** Admin read — default-merged + sanitized (includes the in-house audience). */
  async read(): Promise<FooterConfig> {
    const row = await this.prisma.footer.findUnique({
      where: { id: 'singleton' },
    });
    return this.sanitize(row?.config);
  }

  /** Public read — hides the audience id / opt-in details from the browser. */
  async readPublic(): Promise<FooterConfig> {
    const cfg = await this.read();
    return {
      ...cfg,
      email: {
        ...cfg.email,
        audienceId: null,
        audienceName: null,
        doubleOptIn: false,
      },
    };
  }

  async write(footer: FooterConfig): Promise<FooterConfig> {
    const clean = this.sanitize(footer);
    await this.prisma.footer.upsert({
      where: { id: 'singleton' },
      create: {
        id: 'singleton',
        config: clean as unknown as Prisma.InputJsonValue,
      },
      update: { config: clean as unknown as Prisma.InputJsonValue },
    });
    return clean;
  }

  /** Public email opt-in -> in-house list. Never 500s: a misconfig is a soft result. */
  async subscribe(email: string): Promise<FooterSubscribeResult> {
    const e = (email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(e)) {
      throw new BadRequestException('Enter a valid email address.');
    }
    const cfg = await this.read();
    try {
      // In-house list write. Fires whenever there's a valid email — NOT gated on
      // a configured audience: a null audienceId resolves to the default
      // "Members" audience, so an unconfigured footer still captures everyone.
      const status = await this.contacts.subscribe(
        // null (no configured audience) → default "Members" audience.
        cfg.email.audienceId ?? null,
        e,
        {},
        {
          doubleOptIn: cfg.email.doubleOptIn,
          updateExisting: true,
          source: 'FOOTER',
        },
      );
      return {
        ok: true,
        status,
        message: cfg.email.successMessage || "Thanks! You're subscribed.",
      };
    } catch {
      // Contacts hiccup — surface a friendly message, never 500.
      return {
        ok: false,
        status: 'error',
        message: 'Couldn’t subscribe right now. Please try again later.',
      };
    }
  }
}
