import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { EmailTemplate } from '@prisma/client';
import Handlebars from 'handlebars';
import mjml2html from 'mjml';
import type {
  CreateEmailTemplateInput,
  EmailTemplateDTO,
  UpdateEmailTemplateInput,
} from '@lms/types';
import { PrismaService } from '../prisma/prisma.service';

// The rendered output of a template: a plain-text subject and both an HTML and
// a derived text body, ready to hand straight to EmailService.send().
export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

// Compiles email templates (MJML body + Handlebars merge vars) into sendable
// HTML/text, and owns CRUD for the EmailTemplate table. Two stages per render:
//   1) Handlebars compiles `subject` and `mjml` against the supplied vars.
//   2) mjml2html turns the interpolated MJML into responsive, client-safe HTML.
// The plain-text alternative is derived from the HTML with a lightweight
// tag-strip (good enough for a multipart fallback — not a full HTML renderer).
@Injectable()
export class EmailTemplateService {
  private readonly logger = new Logger(EmailTemplateService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ───────────────────────── render ─────────────────────────

  // Render an ad-hoc template (subject + MJML) with merge vars. Used directly
  // by the live editor preview and by renderByKey/renderById after a DB load.
  // Throws BadRequest only when MJML produced NO html (a hard failure); MJML's
  // soft validation warnings are logged but don't block a usable render.
  render(
    tpl: { subject: string; mjml: string },
    vars: Record<string, unknown>,
  ): RenderedEmail {
    const subject = this.compile(tpl.subject, vars).trim();
    const compiledMjml = this.compile(tpl.mjml, vars);

    let html = '';
    let errors: { message: string }[] = [];
    try {
      const out = mjml2html(compiledMjml, { validationLevel: 'soft' });
      html = out.html ?? '';
      errors = out.errors ?? [];
    } catch (err) {
      // A throw from mjml2html (malformed markup it can't even parse) leaves
      // html empty → handled by the empty-html guard below.
      this.logger.warn(`mjml2html threw: ${this.msg(err)}`);
    }

    if (!html || !html.trim()) {
      const detail = errors.length
        ? errors.map((e) => e.message).join('; ')
        : 'no HTML output';
      throw new BadRequestException(`MJML render failed: ${detail}`);
    }
    if (errors.length) {
      this.logger.debug(
        `MJML soft warnings: ${errors.map((e) => e.message).join('; ')}`,
      );
    }

    return { subject, html, text: this.htmlToText(html) };
  }

  // Load a template by its stable `key` (system templates) then render it.
  async renderByKey(
    key: string,
    vars: Record<string, unknown>,
  ): Promise<RenderedEmail> {
    const tpl = await this.prisma.emailTemplate.findUnique({ where: { key } });
    if (!tpl) throw new NotFoundException(`Email template "${key}" not found`);
    return this.render(tpl, vars);
  }

  // Load a template by id then render it.
  async renderById(
    id: string,
    vars: Record<string, unknown>,
  ): Promise<RenderedEmail> {
    const tpl = await this.prisma.emailTemplate.findUnique({ where: { id } });
    if (!tpl) throw new NotFoundException('Email template not found');
    return this.render(tpl, vars);
  }

  // ───────────────────────── CRUD ─────────────────────────

  async list(): Promise<EmailTemplateDTO[]> {
    const rows = await this.prisma.emailTemplate.findMany({
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
    return rows.map((t) => this.toDTO(t));
  }

  async get(id: string): Promise<EmailTemplateDTO> {
    const tpl = await this.prisma.emailTemplate.findUnique({ where: { id } });
    if (!tpl) throw new NotFoundException('Email template not found');
    return this.toDTO(tpl);
  }

  async create(input: CreateEmailTemplateInput): Promise<EmailTemplateDTO> {
    const tpl = await this.prisma.emailTemplate.create({
      data: {
        name: input.name.trim(),
        subject: input.subject,
        mjml: input.mjml,
        variables: this.cleanVars(input.variables),
        category: input.category?.trim() || null,
        // Admin-authored templates are always custom (key stays null); the
        // reserved `key` namespace belongs to system templates (welcome, …).
      },
    });
    return this.toDTO(tpl);
  }

  async update(
    id: string,
    input: UpdateEmailTemplateInput,
  ): Promise<EmailTemplateDTO> {
    const existing = await this.prisma.emailTemplate.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Email template not found');

    const tpl = await this.prisma.emailTemplate.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.subject !== undefined ? { subject: input.subject } : {}),
        ...(input.mjml !== undefined ? { mjml: input.mjml } : {}),
        ...(input.variables !== undefined
          ? { variables: this.cleanVars(input.variables) }
          : {}),
        ...(input.category !== undefined
          ? { category: input.category?.trim() || null }
          : {}),
      },
    });
    return this.toDTO(tpl);
  }

  // Refuse to delete a system template (key != null): code renders those by key
  // (e.g. the signup welcome mail), so removing one would break a live flow.
  // Custom templates delete freely.
  async deleteTemplate(id: string): Promise<{ ok: true }> {
    const tpl = await this.prisma.emailTemplate.findUnique({ where: { id } });
    if (!tpl) throw new NotFoundException('Email template not found');
    if (tpl.key) {
      throw new BadRequestException(
        `"${tpl.name}" is a system template and can't be deleted (it's sent automatically). You can still edit its content.`,
      );
    }
    await this.prisma.emailTemplate.delete({ where: { id } });
    return { ok: true };
  }

  // ───────────────────── system templates ─────────────────────

  // Idempotently ensure the built-in system templates exist (upsert by `key`),
  // so a fresh DB / no-reseed environment still has e.g. the welcome mail. Only
  // creates when absent — never overwrites admin edits to an existing row.
  async ensureSystemTemplates(): Promise<void> {
    try {
      await this.upsertSystemTemplate({
        key: 'welcome',
        name: 'Welcome email',
        subject: 'Welcome to {{brand}}',
        mjml: WELCOME_MJML,
        variables: ['firstName', 'brand', 'url', 'unsubscribeUrl'],
        category: 'system',
      });
    } catch (err) {
      // Never let a bootstrap-time DB hiccup take down app startup.
      this.logger.warn(`ensureSystemTemplates failed: ${this.msg(err)}`);
    }
  }

  // Create the system template only if its key is absent. We intentionally do
  // NOT update on conflict: the admin may have customized the copy, and a
  // redeploy shouldn't stomp that.
  private async upsertSystemTemplate(tpl: {
    key: string;
    name: string;
    subject: string;
    mjml: string;
    variables: string[];
    category: string;
  }): Promise<void> {
    const existing = await this.prisma.emailTemplate.findUnique({
      where: { key: tpl.key },
      select: { id: true },
    });
    if (existing) return;
    await this.prisma.emailTemplate.create({ data: tpl });
    this.logger.log(`Seeded system email template "${tpl.key}"`);
  }

  // ───────────────────────── helpers ─────────────────────────

  // Compile a Handlebars source against vars. The body keeps HTML-escaping on
  // (noEscape:false) so merged values can't inject markup; the subject is plain
  // text so escaping is harmless there too.
  private compile(source: string, vars: Record<string, unknown>): string {
    const tpl = Handlebars.compile(source, { noEscape: false });
    return tpl(vars ?? {});
  }

  // Lightweight HTML→text for the multipart fallback: drop <style>/<head>,
  // strip tags, decode a few common entities, and collapse whitespace. Not a
  // full renderer — just a readable plain-text alternative.
  private htmlToText(html: string): string {
    return html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(style|head|script)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
      .replace(/<br\s*\/?>(?:\s*)/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&#39;/gi, "'")
      .replace(/&quot;/gi, '"')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .split('\n')
      .map((l) => l.trim())
      .join('\n')
      .trim();
  }

  // Normalize declared var names: trim, drop blanks, dedupe, cap length.
  private cleanVars(vars?: string[]): string[] {
    if (!vars) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of vars) {
      const v = typeof raw === 'string' ? raw.trim() : '';
      if (!v || seen.has(v)) continue;
      seen.add(v);
      out.push(v);
      if (out.length >= 100) break;
    }
    return out;
  }

  private toDTO(t: EmailTemplate): EmailTemplateDTO {
    return {
      id: t.id,
      key: t.key,
      name: t.name,
      subject: t.subject,
      mjml: t.mjml,
      variables: t.variables,
      category: t.category,
      isSystem: t.key != null,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }

  private msg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}

// Branded welcome body (MJML + Handlebars). Violet "liquid glass" palette to
// match the web/admin/mobile design system: greeting, supporting copy and a CTA
// button to {{url}}. Vars: firstName, brand, url.
const WELCOME_MJML = `<mjml>
  <mj-head>
    <mj-attributes>
      <mj-all font-family="Helvetica, Arial, sans-serif" />
    </mj-attributes>
    <mj-style>
      .cta a { color: #ffffff !important; }
    </mj-style>
  </mj-head>
  <mj-body background-color="#f5f3fc">
    <mj-section padding="32px 0 12px">
      <mj-column>
        <mj-text align="center" font-size="13px" letter-spacing="2px" color="#7c5cfc" text-transform="uppercase" font-weight="700">
          {{brand}}
        </mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="#ffffff" border-radius="16px" padding="8px" css-class="card">
      <mj-column padding="24px">
        <mj-text font-size="22px" font-weight="700" color="#251f3d" padding-bottom="12px">
          Welcome, {{firstName}}!
        </mj-text>
        <mj-text font-size="15px" line-height="1.7" color="#5a5470" padding-bottom="24px">
          Your {{brand}} account is ready. Jump back in any time to pick up right where you left off — your classes, lessons and progress are all waiting.
        </mj-text>
        <mj-button href="{{url}}" background-color="#7c5cfc" color="#ffffff" border-radius="10px" font-weight="600" font-size="15px" inner-padding="13px 26px" align="left" css-class="cta">
          Go to {{brand}}
        </mj-button>
        <mj-text font-size="13px" line-height="1.6" color="#8b84a4" padding-top="24px">
          If the button doesn't work, copy and paste this link into your browser:<br />
          <a href="{{url}}" style="color:#7c5cfc;">{{url}}</a>
        </mj-text>
      </mj-column>
    </mj-section>
    <mj-section padding="16px 0 32px">
      <mj-column>
        <mj-text align="center" font-size="12px" color="#a39db8" line-height="1.6">
          You're receiving this because you created an account at {{brand}}.<br />
          <a href="{{unsubscribeUrl}}" style="color:#a39db8; text-decoration:underline;">Unsubscribe</a> from these emails.
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;
