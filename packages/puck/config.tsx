/*
 * Shared Puck configuration for the LMS page builder.
 *
 * The SAME config powers two surfaces:
 *   - the admin editor   (<Puck config={...} />), a client component
 *   - the public website (<Render config={...} />), a server component
 *
 * Every block's `render` is therefore written to be server-renderable (no
 * client-only hooks/handlers — the FAQ uses native <details>, etc.). The only
 * client-side piece is the optional Rich Text *edit field*, which the admin
 * injects via `createPuckConfig({ richTextField })` (it wraps the existing
 * TipTap editor). The public site never passes it, so TipTap never ships there.
 */
import * as React from "react";
import type { Config, Field, Slot } from "@puckeditor/core";

// ---------- shared prop shapes ----------
type Bg = "none" | "muted" | "dark" | "brand";
type Align = "left" | "center" | "right";
type Width = "narrow" | "normal" | "wide" | "full";

export type HeroProps = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  buttonLabel?: string;
  buttonHref?: string;
  align: "left" | "center";
  background: Bg;
};
export type HeadingProps = { text: string; level: "1" | "2" | "3" | "4"; align: Align };
export type RichTextProps = { html: string; align: Align };
export type ImageProps = {
  src: string;
  alt: string;
  width: "normal" | "wide" | "full";
  rounded: boolean;
  caption?: string;
};
export type ButtonProps = {
  label: string;
  href: string;
  variant: "primary" | "secondary" | "outline";
  align: Align;
  newTab: boolean;
};
export type SpacerProps = { height: number };
export type SectionProps = { background: Bg; paddingY: number; maxWidth: Width; content: Slot };
export type ColumnsProps = { columns: "2" | "3" | "4"; gap: number; content: Slot };
export type VideoProps = { url: string; caption?: string };
export type Feature = { title: string; text?: string; imageUrl?: string; href?: string };
export type CardsProps = { columns: "2" | "3" | "4"; items: Feature[] };
export type CtaProps = {
  title: string;
  subtitle?: string;
  buttonLabel: string;
  buttonHref: string;
  background: "muted" | "dark" | "brand";
  align: "left" | "center";
};
export type FaqItem = { question: string; answer: string };
export type FaqProps = { items: FaqItem[] };
export type TestimonialProps = { quote: string; author: string; role?: string; avatarUrl?: string };

export type PageProps = {
  Hero: HeroProps;
  Heading: HeadingProps;
  RichText: RichTextProps;
  Image: ImageProps;
  Button: ButtonProps;
  Spacer: SpacerProps;
  Section: SectionProps;
  Columns: ColumnsProps;
  Video: VideoProps;
  Cards: CardsProps;
  CTA: CtaProps;
  FAQ: FaqProps;
  Testimonial: TestimonialProps;
  Form: { formId: string };
};
// Page-level (SEO) props edited in Puck's "page" settings; title/slug live on
// the Page row and are edited in the editor's top bar instead.
export type RootProps = { seoTitle?: string; description?: string; ogImage?: string };

// ---------- helpers ----------
const cx = (...parts: Array<string | false | undefined>): string =>
  parts.filter(Boolean).join(" ");

const bgClass = (bg: Bg): string =>
  bg === "muted" ? "lmspb-bg-muted" : bg === "dark" ? "lmspb-bg-dark" : bg === "brand" ? "lmspb-bg-brand" : "";

const widthClass = (w: Width): string => `lmspb-w-${w}`;

const BG_OPTIONS = [
  { label: "None", value: "none" },
  { label: "Muted", value: "muted" },
  { label: "Dark", value: "dark" },
  { label: "Brand", value: "brand" },
];
const ALIGN_OPTIONS = [
  { label: "Left", value: "left" },
  { label: "Center", value: "center" },
  { label: "Right", value: "right" },
];
const BOOL_OPTIONS = [
  { label: "Yes", value: true },
  { label: "No", value: false },
];

// Convert a YouTube/Vimeo/MP4 URL into something embeddable. Pure string work
// (no `window`) so it runs on the server too.
function toEmbed(url: string): { kind: "iframe" | "video"; src: string } | null {
  if (!url) return null;
  const u = url.trim();
  const yt = u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/);
  if (yt) return { kind: "iframe", src: `https://www.youtube.com/embed/${yt[1]}` };
  const vimeo = u.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeo) return { kind: "iframe", src: `https://player.vimeo.com/video/${vimeo[1]}` };
  if (/\.(mp4|webm|ogg)(\?.*)?$/i.test(u)) return { kind: "video", src: u };
  return { kind: "iframe", src: u }; // assume it's already an embed URL
}

// The Rich Text edit field defaults to a plain textarea; the admin overrides it
// with a TipTap-backed custom field via createPuckConfig({ richTextField }).
const DEFAULT_RICH_TEXT_FIELD: Field = { type: "textarea" };

export type PuckConfigOptions = {
  /** Custom Puck field for the RichText block's `html` prop (admin injects TipTap). */
  richTextField?: Field;
  /** Renders an embedded form by id — web injects <FormEmbed>; admin a preview. */
  formComponent?: React.ComponentType<{ formId: string }>;
  /**
   * Custom Puck field for the Form block's `formId` prop. The admin injects a
   * dropdown of existing forms (pick by name); the public site never passes it,
   * so it falls back to a plain text input there.
   */
  formField?: Field;
};

export function createPuckConfig(
  opts: PuckConfigOptions = {},
): Config<PageProps, RootProps> {
  const richTextField = opts.richTextField ?? DEFAULT_RICH_TEXT_FIELD;
  const FormComponent = opts.formComponent;
  const formField: Field =
    opts.formField ?? {
      type: "text",
      label: "Form ID (copy it from the Forms tab)",
    };

  return {
    root: {
      fields: {
        seoTitle: { type: "text", label: "SEO title (optional override)" },
        description: { type: "textarea", label: "Meta description" },
        ogImage: { type: "text", label: "Social share image URL" },
      },
      defaultProps: { seoTitle: "", description: "", ogImage: "" },
      // Wrap all page content so block CSS variables + base styles apply in
      // BOTH the editor canvas and the public <Render> output.
      render: ({ children }) => <div className="lmspb-root">{children}</div>,
    },

    categories: {
      sections: {
        title: "Sections",
        components: ["Hero", "CTA", "Cards", "FAQ", "Testimonial"],
      },
      layout: { title: "Layout", components: ["Section", "Columns", "Spacer"] },
      content: {
        title: "Content",
        components: ["Heading", "RichText", "Image", "Button", "Video", "Form"],
      },
    },

    components: {
      // ---------------- Hero ----------------
      Hero: {
        label: "Hero",
        fields: {
          eyebrow: { type: "text", label: "Eyebrow" },
          title: { type: "text", label: "Title" },
          subtitle: { type: "textarea", label: "Subtitle" },
          buttonLabel: { type: "text", label: "Button label" },
          buttonHref: { type: "text", label: "Button link" },
          align: { type: "radio", options: [
            { label: "Left", value: "left" },
            { label: "Center", value: "center" },
          ] },
          background: { type: "select", options: BG_OPTIONS },
        },
        defaultProps: {
          eyebrow: "",
          title: "Your headline goes here",
          subtitle: "A short supporting sentence that explains the value.",
          buttonLabel: "Get started",
          buttonHref: "#",
          align: "center",
          background: "muted",
        },
        render: ({ eyebrow, title, subtitle, buttonLabel, buttonHref, align, background }) => (
          <section className={cx("lmspb-section", bgClass(background))}>
            <div className={cx("lmspb-container", "lmspb-w-normal", "lmspb-hero", `lmspb-al-${align}`)}>
              {eyebrow ? <p className="lmspb-hero-eyebrow">{eyebrow}</p> : null}
              <h1 className="lmspb-hero-title">{title}</h1>
              {subtitle ? <p className="lmspb-hero-sub">{subtitle}</p> : null}
              {buttonLabel ? (
                <div className={cx("lmspb-actions", `lmspb-al-${align}`)}>
                  <a className="lmspb-btn lmspb-btn-primary" href={buttonHref || "#"}>
                    {buttonLabel}
                  </a>
                </div>
              ) : null}
            </div>
          </section>
        ),
      },

      // ---------------- Heading ----------------
      Heading: {
        label: "Heading",
        fields: {
          text: { type: "text", label: "Text" },
          level: { type: "select", options: [
            { label: "H1", value: "1" },
            { label: "H2", value: "2" },
            { label: "H3", value: "3" },
            { label: "H4", value: "4" },
          ] },
          align: { type: "radio", options: ALIGN_OPTIONS },
        },
        defaultProps: { text: "Section heading", level: "2", align: "left" },
        render: ({ text, level, align }) => {
          const Tag = (`h${level}` as unknown) as keyof JSX.IntrinsicElements;
          return (
            <div className={cx("lmspb-container", "lmspb-w-normal")}>
              <Tag className={cx("lmspb-heading", `lmspb-al-${align}`)}>{text}</Tag>
            </div>
          );
        },
      },

      // ---------------- Rich text ----------------
      RichText: {
        label: "Rich text",
        fields: {
          html: richTextField,
          align: { type: "radio", options: ALIGN_OPTIONS },
        },
        defaultProps: { html: "<p>Write something compelling…</p>", align: "left" },
        render: ({ html, align }) => (
          <div className={cx("lmspb-container", "lmspb-w-normal")}>
            <div
              className={cx("lmspb-richtext", `lmspb-al-${align}`)}
              // Sanitized server-side on write (sanitize-html in the API).
              dangerouslySetInnerHTML={{ __html: html || "" }}
            />
          </div>
        ),
      },

      // ---------------- Image ----------------
      Image: {
        label: "Image",
        fields: {
          src: { type: "text", label: "Image URL" },
          alt: { type: "text", label: "Alt text" },
          width: { type: "select", options: [
            { label: "Normal", value: "normal" },
            { label: "Wide", value: "wide" },
            { label: "Full width", value: "full" },
          ] },
          rounded: { type: "radio", options: BOOL_OPTIONS },
          caption: { type: "text", label: "Caption" },
        },
        defaultProps: { src: "", alt: "", width: "normal", rounded: true, caption: "" },
        render: ({ src, alt, width, rounded, caption }) => (
          <div className={cx("lmspb-container", "lmspb-w-wide")}>
            <figure className="lmspb-figure">
              {src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={src}
                  alt={alt || ""}
                  className={cx("lmspb-img", `lmspb-img-${width}`, rounded && "lmspb-img-rounded")}
                />
              ) : null}
              {caption ? <figcaption className="lmspb-caption">{caption}</figcaption> : null}
            </figure>
          </div>
        ),
      },

      // ---------------- Button ----------------
      Button: {
        label: "Button",
        fields: {
          label: { type: "text", label: "Label" },
          href: { type: "text", label: "Link" },
          variant: { type: "select", options: [
            { label: "Primary", value: "primary" },
            { label: "Secondary", value: "secondary" },
            { label: "Outline", value: "outline" },
          ] },
          align: { type: "radio", options: ALIGN_OPTIONS },
          newTab: { type: "radio", options: BOOL_OPTIONS },
        },
        defaultProps: { label: "Click me", href: "#", variant: "primary", align: "left", newTab: false },
        render: ({ label, href, variant, align, newTab }) => (
          <div className={cx("lmspb-container", "lmspb-w-normal")}>
            <div className={cx("lmspb-actions", `lmspb-al-${align}`)}>
              <a
                className={cx("lmspb-btn", `lmspb-btn-${variant}`)}
                href={href || "#"}
                target={newTab ? "_blank" : undefined}
                rel={newTab ? "noopener noreferrer" : undefined}
              >
                {label}
              </a>
            </div>
          </div>
        ),
      },

      // ---------------- Spacer ----------------
      Spacer: {
        label: "Spacer",
        fields: { height: { type: "number", label: "Height (px)", min: 0, max: 400 } },
        defaultProps: { height: 48 },
        render: ({ height }) => <div className="lmspb-spacer" style={{ height: `${height}px` }} />,
      },

      // ---------------- Section (container band) ----------------
      Section: {
        label: "Section",
        fields: {
          background: { type: "select", options: BG_OPTIONS },
          paddingY: { type: "number", label: "Vertical padding (px)", min: 0, max: 200 },
          maxWidth: { type: "select", options: [
            { label: "Narrow", value: "narrow" },
            { label: "Normal", value: "normal" },
            { label: "Wide", value: "wide" },
            { label: "Full", value: "full" },
          ] },
          content: { type: "slot" },
        },
        defaultProps: { background: "none", paddingY: 48, maxWidth: "normal", content: [] },
        render: ({ background, paddingY, maxWidth, content: Content }) => (
          <section
            className={cx("lmspb-section", bgClass(background))}
            style={{ paddingTop: `${paddingY}px`, paddingBottom: `${paddingY}px` }}
          >
            <div className={cx("lmspb-container", widthClass(maxWidth))}>
              <Content />
            </div>
          </section>
        ),
      },

      // ---------------- Columns (CSS grid) ----------------
      Columns: {
        label: "Columns",
        fields: {
          columns: { type: "select", options: [
            { label: "2 columns", value: "2" },
            { label: "3 columns", value: "3" },
            { label: "4 columns", value: "4" },
          ] },
          gap: { type: "number", label: "Gap (px)", min: 0, max: 80 },
          content: { type: "slot" },
        },
        defaultProps: { columns: "2", gap: 24, content: [] },
        render: ({ columns, gap, content: Content }) => (
          <div className={cx("lmspb-container", "lmspb-w-normal")}>
            <Content
              className="lmspb-grid"
              style={{ gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: `${gap}px` }}
            />
          </div>
        ),
      },

      // ---------------- Video ----------------
      Video: {
        label: "Video",
        fields: {
          url: { type: "text", label: "YouTube / Vimeo / MP4 URL" },
          caption: { type: "text", label: "Caption" },
        },
        defaultProps: { url: "", caption: "" },
        render: ({ url, caption }) => {
          const embed = toEmbed(url);
          return (
            <div className={cx("lmspb-container", "lmspb-w-normal")}>
              <figure className="lmspb-figure">
                <div className="lmspb-video">
                  {embed?.kind === "video" ? (
                    <video src={embed.src} controls />
                  ) : embed ? (
                    <iframe
                      src={embed.src}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      title={caption || "Video"}
                    />
                  ) : null}
                </div>
                {caption ? <figcaption className="lmspb-caption">{caption}</figcaption> : null}
              </figure>
            </div>
          );
        },
      },

      // ---------------- Cards / feature grid ----------------
      Cards: {
        label: "Card grid",
        fields: {
          columns: { type: "select", options: [
            { label: "2 columns", value: "2" },
            { label: "3 columns", value: "3" },
            { label: "4 columns", value: "4" },
          ] },
          items: {
            type: "array",
            label: "Cards",
            getItemSummary: (item: Feature, i) => item?.title || `Card ${(i ?? 0) + 1}`,
            arrayFields: {
              imageUrl: { type: "text", label: "Image URL" },
              title: { type: "text", label: "Title" },
              text: { type: "textarea", label: "Text" },
              href: { type: "text", label: "Link (optional)" },
            },
            defaultItemProps: { title: "Card title", text: "Card description", imageUrl: "", href: "" },
          },
        },
        defaultProps: {
          columns: "3",
          items: [
            { title: "First", text: "Describe a feature or benefit." },
            { title: "Second", text: "Describe a feature or benefit." },
            { title: "Third", text: "Describe a feature or benefit." },
          ],
        },
        render: ({ columns, items }) => (
          <div className={cx("lmspb-container", "lmspb-w-normal")}>
            <div className="lmspb-cards" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
              {(items || []).map((it, i) => {
                const inner = (
                  <>
                    {it.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="lmspb-card-img" src={it.imageUrl} alt={it.title || ""} />
                    ) : null}
                    <p className="lmspb-card-title">{it.title}</p>
                    {it.text ? <p className="lmspb-card-text">{it.text}</p> : null}
                  </>
                );
                return it.href ? (
                  <a key={i} className="lmspb-card" href={it.href}>{inner}</a>
                ) : (
                  <div key={i} className="lmspb-card">{inner}</div>
                );
              })}
            </div>
          </div>
        ),
      },

      // ---------------- CTA banner ----------------
      CTA: {
        label: "CTA banner",
        fields: {
          title: { type: "text", label: "Title" },
          subtitle: { type: "textarea", label: "Subtitle" },
          buttonLabel: { type: "text", label: "Button label" },
          buttonHref: { type: "text", label: "Button link" },
          background: { type: "select", options: [
            { label: "Muted", value: "muted" },
            { label: "Dark", value: "dark" },
            { label: "Brand", value: "brand" },
          ] },
          align: { type: "radio", options: [
            { label: "Left", value: "left" },
            { label: "Center", value: "center" },
          ] },
        },
        defaultProps: {
          title: "Ready to get started?",
          subtitle: "Join today and get instant access.",
          buttonLabel: "Join now",
          buttonHref: "#",
          background: "brand",
          align: "center",
        },
        render: ({ title, subtitle, buttonLabel, buttonHref, background, align }) => (
          <div className={cx("lmspb-container", "lmspb-w-normal")}>
            <div className={cx("lmspb-section", bgClass(background), "lmspb-cta", `lmspb-al-${align}`)}>
              <div className={cx("lmspb-container", "lmspb-w-narrow")}>
                <h2 className="lmspb-cta-title">{title}</h2>
                {subtitle ? <p className="lmspb-cta-sub">{subtitle}</p> : null}
                <div className={cx("lmspb-actions", `lmspb-al-${align}`)}>
                  <a className="lmspb-btn lmspb-btn-primary" href={buttonHref || "#"}>{buttonLabel}</a>
                </div>
              </div>
            </div>
          </div>
        ),
      },

      // ---------------- FAQ / accordion (native <details>) ----------------
      FAQ: {
        label: "FAQ",
        fields: {
          items: {
            type: "array",
            label: "Questions",
            getItemSummary: (item: FaqItem, i) => item?.question || `Question ${(i ?? 0) + 1}`,
            arrayFields: {
              question: { type: "text", label: "Question" },
              answer: { type: "textarea", label: "Answer" },
            },
            defaultItemProps: { question: "Question?", answer: "Answer." },
          },
        },
        defaultProps: {
          items: [
            { question: "How does it work?", answer: "Explain it here." },
            { question: "Can I cancel anytime?", answer: "Yes, anytime." },
          ],
        },
        render: ({ items }) => (
          <div className={cx("lmspb-container", "lmspb-w-narrow")}>
            <div className="lmspb-faq">
              {(items || []).map((it, i) => (
                <details className="lmspb-faq-item" key={i}>
                  <summary>{it.question}</summary>
                  <div className="lmspb-faq-answer">{it.answer}</div>
                </details>
              ))}
            </div>
          </div>
        ),
      },

      // ---------------- Testimonial ----------------
      Testimonial: {
        label: "Testimonial",
        fields: {
          quote: { type: "textarea", label: "Quote" },
          author: { type: "text", label: "Author" },
          role: { type: "text", label: "Role / company" },
          avatarUrl: { type: "text", label: "Avatar URL" },
        },
        defaultProps: {
          quote: "This product changed how we work. Highly recommended.",
          author: "Jane Doe",
          role: "Founder, Acme",
          avatarUrl: "",
        },
        render: ({ quote, author, role, avatarUrl }) => (
          <div className={cx("lmspb-container", "lmspb-w-narrow")}>
            <blockquote className="lmspb-quote">
              <p className="lmspb-quote-text">“{quote}”</p>
              <div className="lmspb-quote-by">
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="lmspb-quote-avatar" src={avatarUrl} alt={author || ""} />
                ) : null}
                <div>
                  <div className="lmspb-quote-author">{author}</div>
                  {role ? <div className="lmspb-quote-role">{role}</div> : null}
                </div>
              </div>
            </blockquote>
          </div>
        ),
      },

      // ---------------- Form (Mailchimp-linked) ----------------
      Form: {
        label: "Form",
        fields: {
          formId: formField,
        },
        defaultProps: { formId: "" },
        render: ({ formId }) =>
          FormComponent && formId ? (
            <FormComponent formId={formId} />
          ) : (
            <div className="lmspb-container lmspb-w-normal">
              <div className="lmspb-form-placeholder">
                {formId
                  ? `Form: ${formId}`
                  : "Form block — set a Form ID in the field panel"}
              </div>
            </div>
          ),
      },
    },
  };
}
