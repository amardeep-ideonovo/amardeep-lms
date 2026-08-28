import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type { EmailTemplate } from "@prisma/client";
import Handlebars from "handlebars";
import mjml2html from "mjml";
import type {
  CreateEmailTemplateInput,
  EmailTemplateDTO,
  EmailTemplateSummaryDTO,
  UpdateEmailTemplateInput,
} from "@lms/types";
import { PrismaService } from "../prisma/prisma.service";

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

    let html = "";
    let errors: { message: string }[] = [];
    try {
      const out = mjml2html(compiledMjml, { validationLevel: "soft" });
      html = out.html ?? "";
      errors = out.errors ?? [];
    } catch (err) {
      // A throw from mjml2html (malformed markup it can't even parse) leaves
      // html empty → handled by the empty-html guard below.
      this.logger.warn(`mjml2html threw: ${this.msg(err)}`);
    }

    if (!html || !html.trim()) {
      const detail = errors.length
        ? errors.map((e) => e.message).join("; ")
        : "no HTML output";
      throw new BadRequestException(`MJML render failed: ${detail}`);
    }
    if (errors.length) {
      this.logger.debug(
        `MJML soft warnings: ${errors.map((e) => e.message).join("; ")}`,
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
    if (!tpl) throw new NotFoundException("Email template not found");
    return this.render(tpl, vars);
  }

  // ───────────────────────── CRUD ─────────────────────────

  async list(): Promise<EmailTemplateDTO[]> {
    const rows = await this.prisma.emailTemplate.findMany({
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
    return rows.map((t) => this.toDTO(t));
  }

  // Lightweight list for dropdown/picker consumers — drops the heavy
  // mjml/subject/variables. The editor keeps list() (full shape).
  async listSummary(): Promise<EmailTemplateSummaryDTO[]> {
    const rows = await this.prisma.emailTemplate.findMany({
      orderBy: [{ category: "asc" }, { name: "asc" }],
      select: { id: true, key: true, name: true, category: true },
    });
    return rows.map((t) => ({
      id: t.id,
      name: t.name,
      key: t.key,
      category: t.category,
      isSystem: t.key != null,
    }));
  }

  async get(id: string): Promise<EmailTemplateDTO> {
    const tpl = await this.prisma.emailTemplate.findUnique({ where: { id } });
    if (!tpl) throw new NotFoundException("Email template not found");
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
    if (!existing) throw new NotFoundException("Email template not found");

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
    if (!tpl) throw new NotFoundException("Email template not found");
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
        key: "welcome",
        name: "Welcome email",
        subject: "Welcome to {{brand}}",
        mjml: WELCOME_MJML,
        variables: ["firstName", "brand", "url", "unsubscribeUrl"],
        category: "system",
      });
      await this.upsertSystemTemplate({
        key: "password-reset",
        name: "Password reset",
        subject: "Reset your {{brand}} password",
        mjml: PASSWORD_RESET_MJML,
        variables: ["firstName", "brand", "resetUrl", "expiresMinutes"],
        category: "system",
      });
      await this.upsertSystemTemplate({
        key: "helpdesk-reply",
        name: "Support reply",
        subject: "{{brand}} support replied to \u201c{{requestSubject}}\u201d",
        mjml: HELPDESK_REPLY_MJML,
        variables: [
          "firstName",
          "brand",
          "requestSubject",
          "replyPreview",
          "url",
          "unsubscribeUrl",
        ],
        category: "system",
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
  //
  // Decode ORDER is a correctness issue, not just cosmetic. We strip real markup
  // FIRST (while `<`/`>` still unambiguously delimit tags), and only THEN decode
  // entities — so the decode can never feed a second tag-strip pass and resurrect
  // markup. Two ordering rules within the decode keep escaped markup inert:
  //   • `&amp;` is decoded LAST, so a double-escaped `&amp;lt;script&amp;gt;`
  //     collapses to the literal text `&lt;script&gt;` — never a live `<script>`
  //     (the old code decoded `&amp;`→`&` and then `&lt;`→`<`, reviving the tag).
  //   • `&lt;`/`&gt;` are decoded to literal `<`/`>` only as plain text at the
  //     very end; with no tag-strip running afterward they stay inert characters,
  //     which also preserves legitimate uses like `5 &lt; 10`.
  private htmlToText(html: string): string {
    return (
      html
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<(style|head|script)[\s\S]*?<\/\1>/gi, " ")
        // Strip structural/real tags while brackets still mean "tag".
        .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, "\n")
        .replace(/<br\s*\/?>(?:\s*)/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        // Text-only entities first; bracket + ampersand entities decoded last (and
        // &amp; the very last) so escaped markup can't be reassembled into a tag.
        .replace(/&nbsp;/gi, " ")
        .replace(/&#39;/gi, "'")
        .replace(/&quot;/gi, '"')
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&amp;/gi, "&")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .split("\n")
        .map((l) => l.trim())
        .join("\n")
        .trim()
    );
  }

  // Normalize declared var names: trim, drop blanks, dedupe, cap length.
  private cleanVars(vars?: string[]): string[] {
    if (!vars) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of vars) {
      const v = typeof raw === "string" ? raw.trim() : "";
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

// Branded welcome body (MJML + Handlebars). Spark palette (cream body, ink
// text, teal CTA with ink label) to match the web/admin/mobile design system:
// greeting, supporting copy and a CTA button to {{url}}. Vars: firstName,
// brand, url.
const WELCOME_MJML = `<mjml>
  <mj-head>
    <mj-attributes>
      <mj-all font-family="Helvetica, Arial, sans-serif" />
    </mj-attributes>
    <mj-style>
      .cta a { color: #ffffff !important; }
    </mj-style>
  </mj-head>
  <mj-body background-color="#f4f3f8">
    <mj-section padding="32px 0 12px">
      <mj-column>
        <mj-text align="center" font-size="13px" letter-spacing="2px" color="#1f7a62" text-transform="uppercase" font-weight="700">
          {{brand}}
        </mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="#ffffff" border-radius="16px" padding="8px" css-class="card">
      <mj-column padding="24px">
        <mj-text font-size="22px" font-weight="700" color="#221c3d" padding-bottom="12px">
          Welcome, {{firstName}}!
        </mj-text>
        <mj-text font-size="15px" line-height="1.7" color="#55506e" padding-bottom="24px">
          Your {{brand}} account is ready. Jump back in any time to pick up right where you left off — your classes, lessons and progress are all waiting.
        </mj-text>
        <mj-button href="{{url}}" background-color="#2f9d8e" color="#ffffff" border-radius="10px" font-weight="600" font-size="15px" inner-padding="13px 26px" align="left" css-class="cta">
          Go to {{brand}}
        </mj-button>
        <mj-text font-size="13px" line-height="1.6" color="#8b87a3" padding-top="24px">
          If the button doesn't work, copy and paste this link into your browser:<br />
          <a href="{{url}}" style="color:#1f7a62;">{{url}}</a>
        </mj-text>
      </mj-column>
    </mj-section>
    <mj-section padding="16px 0 32px">
      <mj-column>
        <mj-text align="center" font-size="12px" color="#a3a19c" line-height="1.6">
          You're receiving this because you created an account at {{brand}}.<br />
          <a href="{{unsubscribeUrl}}" style="color:#a3a19c; text-decoration:underline;">Unsubscribe</a> from these emails.
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;

// Password-reset body (MJML + Handlebars), same Spark look as
// the welcome mail. Transactional/security copy: who asked, what to do, how
// long the link lives, and that ignoring it is safe. Deliberately NO
// unsubscribe footer — this is account mail, not marketing. The raw link is
// repeated as text so the derived plain-text part carries a usable URL too.
// resetUrl is rendered with TRIPLE-stache: it's built server-side (never
// user input), and escaped {{...}} would turn `?token=` into `?token&#x3D;`
// — fine for browsers parsing the HTML href, but it corrupts the URL in the
// derived plain-text alternative. Vars: firstName, brand, resetUrl,
// expiresMinutes.
const PASSWORD_RESET_MJML = `<mjml>
  <mj-head>
    <mj-attributes>
      <mj-all font-family="Helvetica, Arial, sans-serif" />
    </mj-attributes>
    <mj-style>
      .cta a { color: #ffffff !important; }
    </mj-style>
  </mj-head>
  <mj-body background-color="#f4f3f8">
    <mj-section padding="32px 0 12px">
      <mj-column>
        <mj-text align="center" font-size="13px" letter-spacing="2px" color="#1f7a62" text-transform="uppercase" font-weight="700">
          {{brand}}
        </mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="#ffffff" border-radius="16px" padding="8px" css-class="card">
      <mj-column padding="24px">
        <mj-text font-size="22px" font-weight="700" color="#221c3d" padding-bottom="12px">
          Reset your password
        </mj-text>
        <mj-text font-size="15px" line-height="1.7" color="#55506e" padding-bottom="24px">
          Hi {{firstName}}, we received a request to reset the password for your {{brand}} account. Click the button below to choose a new one. This link expires in {{expiresMinutes}} minutes and can only be used once.
        </mj-text>
        <mj-button href="{{{resetUrl}}}" background-color="#2f9d8e" color="#ffffff" border-radius="10px" font-weight="600" font-size="15px" inner-padding="13px 26px" align="left" css-class="cta">
          Choose a new password
        </mj-button>
        <mj-text font-size="13px" line-height="1.6" color="#8b87a3" padding-top="24px">
          If the button doesn't work, copy and paste this link into your browser:<br />
          <a href="{{{resetUrl}}}" style="color:#1f7a62;">{{{resetUrl}}}</a>
        </mj-text>
        <mj-text font-size="13px" line-height="1.6" color="#8b87a3" padding-top="16px">
          Didn't request this? You can safely ignore this email — your password won't change until you set a new one.
        </mj-text>
      </mj-column>
    </mj-section>
    <mj-section padding="16px 0 32px">
      <mj-column>
        <mj-text align="center" font-size="12px" color="#a3a19c" line-height="1.6">
          You're receiving this because a password reset was requested for your {{brand}} account.
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;

// Sent when an admin replies to a member's support request and the member has
// not yet seen it (the service gates on unreadForMember, so a burst of replies
// produces one email). Without this, a reply sat invisible until the member
// happened to reopen the app — the whole point of escalating leaked away.
const HELPDESK_REPLY_MJML = `<mjml>
  <mj-head>
    <mj-attributes>
      <mj-all font-family="Helvetica, Arial, sans-serif" />
    </mj-attributes>
    <mj-style>
      .cta a { color: #ffffff !important; }
    </mj-style>
  </mj-head>
  <mj-body background-color="#f4f3f8">
    <mj-section padding="32px 0 12px">
      <mj-column>
        <mj-text align="center" font-size="13px" letter-spacing="2px" color="#1f7a62" text-transform="uppercase" font-weight="700">
          {{brand}}
        </mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="#ffffff" border-radius="16px" padding="8px" css-class="card">
      <mj-column padding="24px">
        <mj-text font-size="22px" font-weight="700" color="#221c3d" padding-bottom="12px">
          The team replied to your request
        </mj-text>
        <mj-text font-size="15px" line-height="1.7" color="#55506e" padding-bottom="8px">
          Hi {{firstName}}, there's a new reply on \u201c{{requestSubject}}\u201d:
        </mj-text>
        <mj-text font-size="14px" line-height="1.7" color="#221c3d" padding="14px 16px" background-color="#f4f3f8" border-radius="10px" css-class="quote">
          {{replyPreview}}
        </mj-text>
        <mj-button href="{{{url}}}" background-color="#2f9d8e" color="#ffffff" border-radius="10px" font-weight="600" font-size="15px" inner-padding="13px 26px" align="left" padding-top="20px" css-class="cta">
          Read and reply
        </mj-button>
        <mj-text font-size="13px" line-height="1.6" color="#8b87a3" padding-top="20px">
          Open the site and tap \u201cGet help\u201d to see the full conversation and reply.
        </mj-text>
      </mj-column>
    </mj-section>
    <mj-section padding="16px 0 32px">
      <mj-column>
        <mj-text align="center" font-size="12px" color="#a3a19c" line-height="1.6">
          You're receiving this because you contacted {{brand}} support.
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;
