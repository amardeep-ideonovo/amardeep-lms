/*
 * Shared Puck configuration for the LMS page builder.
 *
 * The SAME config powers two surfaces:
 *   - the admin editor   (<Puck config={...} />), a client component
 *   - the public website (<Render config={...} />), a server component
 *
 * Every block's `render` is therefore written to be server-renderable (no
 * client-only hooks/handlers — the FAQ uses native <details>, etc.). The only
 * client-side pieces are optional *edit fields* the admin injects via
 * `createPuckConfig({...})` (TipTap rich text, media picker, color picker).
 * The public site never passes them, so none of that ships there.
 *
 * DESIGN CONTROLS: every block carries an optional `design` prop (an
 * Elementor-style "Advanced" group): text/background color, padding, margins,
 * radius, shadow, font size, hide-per-device, entrance animation and anchor id.
 * It is rendered by the shared <Designed> wrapper so the controls behave
 * identically on every block, and old documents (no `design` prop) are
 * untouched. The native app honours the layout subset (background, spacing,
 * radius, hide-on-mobile) in its own renderer.
 */
import * as React from "react";
import type { Config, Field, Slot } from "@puckeditor/core";

// ---------- shared prop shapes ----------
type Bg = "none" | "muted" | "dark" | "brand";
type Align = "left" | "center" | "right";
type Width = "narrow" | "normal" | "wide" | "full";

// Per-block design overrides (all optional — absent means "theme default").
// Kept JSON-portable: the native renderer reads the same keys.
export type DesignProps = {
  textColor?: string; // any CSS color
  background?: string; // any CSS color/gradient; overrides preset bands
  paddingY?: number; // px
  paddingX?: number; // px
  marginTop?: number; // px
  marginBottom?: number; // px
  radius?: number; // px
  shadow?: "" | "soft" | "medium" | "large";
  fontSize?: number; // px; 0/absent = default (cascades to the block's text)
  hideOn?: "" | "mobile" | "desktop";
  animation?: "" | "fade" | "rise" | "zoom";
  anchorId?: string; // CSS id, lets menus link to #anchor
};

export type HeroProps = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  buttonLabel?: string;
  buttonHref?: string;
  align: "left" | "center";
  background: Bg;
  design?: DesignProps;
};
export type HeadingProps = {
  text: string;
  level: "1" | "2" | "3" | "4";
  align: Align;
  design?: DesignProps;
};
export type RichTextProps = { html: string; align: Align; design?: DesignProps };
export type ImageProps = {
  src: string;
  alt: string;
  width: "normal" | "wide" | "full";
  rounded: boolean;
  caption?: string;
  design?: DesignProps;
};
export type ButtonProps = {
  label: string;
  href: string;
  variant: "primary" | "secondary" | "outline";
  align: Align;
  newTab: boolean;
  design?: DesignProps;
};
export type SpacerProps = { height: number };
export type SectionProps = {
  background: Bg;
  paddingY: number;
  maxWidth: Width;
  content: Slot;
  design?: DesignProps;
};
export type ColumnsProps = {
  columns: "2" | "3" | "4";
  gap: number;
  content: Slot;
  design?: DesignProps;
};
export type VideoProps = { url: string; caption?: string; design?: DesignProps };
export type Feature = { title: string; text?: string; imageUrl?: string; href?: string };
export type CardsProps = { columns: "2" | "3" | "4"; items: Feature[]; design?: DesignProps };
export type CtaProps = {
  title: string;
  subtitle?: string;
  buttonLabel: string;
  buttonHref: string;
  background: "muted" | "dark" | "brand";
  align: "left" | "center";
  design?: DesignProps;
};
export type FaqItem = { question: string; answer: string };
export type FaqProps = { items: FaqItem[]; design?: DesignProps };
export type TestimonialProps = {
  quote: string;
  author: string;
  role?: string;
  avatarUrl?: string;
  design?: DesignProps;
};
export type DividerProps = {
  width: Width;
  thickness: number;
  style: "solid" | "dashed" | "dotted";
  color: string; // '' = theme border color
  design?: DesignProps;
};
export type IconListItem = { text: string };
export type IconListProps = {
  icon: "check" | "star" | "arrow" | "dot" | "cross";
  columns: "1" | "2";
  iconColor: string; // '' = brand color
  items: IconListItem[];
  design?: DesignProps;
};
export type StatItem = { value: string; label: string };
export type StatsProps = { columns: "2" | "3" | "4"; items: StatItem[]; design?: DesignProps };
// Raw markup escape hatch. The API sanitizes the `html` prop on write exactly
// like RichText (scripts/iframes stripped), so this is for tables, custom
// typography, address blocks — not third-party embed scripts.
export type EmbedProps = { html: string; design?: DesignProps };

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
  Divider: DividerProps;
  IconList: IconListProps;
  Stats: StatsProps;
  Embed: EmbedProps;
  Form: { formId: string };
  Menu: { menuId: string };
};
// Page-level (SEO) props edited in Puck's "page" settings; title/slug live on
// the Page row and are edited in the editor's top bar instead. Popups pass
// surface:"popup" and get no root fields (a popup has no SEO surface).
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

// ---------- design wrapper ----------
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// Resolve a design prop into wrapper attributes. `ownBackground` is set by the
// band blocks (Hero/CTA/Section) that paint design.background on their own
// band element instead (so it replaces the preset, not wraps around it).
function designAttrs(
  d: DesignProps | undefined,
  ownBackground: boolean,
): { id?: string; className?: string; style?: React.CSSProperties } | null {
  if (!d) return null;
  const style: React.CSSProperties & { [key: string]: string | number | undefined } = {};
  const cls: string[] = [];
  if (d.textColor) style.color = d.textColor;
  if (d.background && !ownBackground) style.background = d.background;
  if (isNum(d.paddingY) && d.paddingY > 0) {
    style.paddingTop = d.paddingY;
    style.paddingBottom = d.paddingY;
  }
  if (isNum(d.paddingX) && d.paddingX > 0) {
    style.paddingLeft = d.paddingX;
    style.paddingRight = d.paddingX;
  }
  if (isNum(d.marginTop) && d.marginTop > 0) style.marginTop = d.marginTop;
  if (isNum(d.marginBottom) && d.marginBottom > 0) style.marginBottom = d.marginBottom;
  if (isNum(d.radius) && d.radius > 0) {
    style.borderRadius = d.radius;
    style.overflow = "hidden";
  }
  if (d.shadow) cls.push(`lmspb-sh-${d.shadow}`);
  if (isNum(d.fontSize) && d.fontSize > 0) {
    cls.push("lmspb-fs");
    style["--lmspb-fs"] = `${d.fontSize}px`;
  }
  if (d.hideOn === "mobile") cls.push("lmspb-hide-mobile");
  if (d.hideOn === "desktop") cls.push("lmspb-hide-desktop");
  if (d.animation) cls.push(`lmspb-anim-${d.animation}`);
  const id = d.anchorId?.trim() || undefined;
  if (!id && cls.length === 0 && Object.keys(style).length === 0) return null;
  return {
    id,
    className: cls.length ? cls.join(" ") : undefined,
    style: Object.keys(style).length ? style : undefined,
  };
}

// Wraps a block's output with its design overrides; renders nothing extra when
// the design group is untouched (old documents stay byte-identical in the DOM).
function Designed({
  d,
  ownBackground = false,
  children,
}: {
  d?: DesignProps;
  ownBackground?: boolean;
  children: React.ReactNode;
}) {
  const attrs = designAttrs(d, ownBackground);
  if (!attrs) return <>{children}</>;
  return (
    <div id={attrs.id} className={cx("lmspb-design", attrs.className)} style={attrs.style}>
      {children}
    </div>
  );
}

// Inline background override for the band blocks (Hero/CTA/Section).
const bandBg = (d?: DesignProps): React.CSSProperties | undefined =>
  d?.background ? { background: d.background } : undefined;

// ---------- icon set (inline SVG, no font dependency) ----------
function ListIcon({ icon, color }: { icon: IconListProps["icon"]; color: string }) {
  const c = color || "var(--lmspb-brand)";
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", "aria-hidden": true } as const;
  switch (icon) {
    case "star":
      return (
        <svg {...common} fill={c}>
          <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      );
    case "dot":
      return (
        <svg {...common} fill={c}>
          <circle cx="12" cy="12" r="4" />
        </svg>
      );
    case "arrow":
      return (
        <svg {...common} fill="none" stroke={c} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      );
    case "cross":
      return (
        <svg {...common} fill="none" stroke={c} strokeWidth="2.4" strokeLinecap="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      );
    case "check":
    default:
      return (
        <svg {...common} fill="none" stroke={c} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      );
  }
}

// Editor-only placeholder for blocks whose media/reference is still unset.
// Without it those blocks render ZERO-HEIGHT in the canvas — invisible,
// unselectable, and their selection chrome lands on top of the previous
// sibling (looks like blocks stacked "over each other"). The public site
// renders unconfigured blocks as nothing.
function EmptyHint({ label }: { label: string }) {
  return (
    <div className="lmspb-container lmspb-w-normal">
      <div className="lmspb-form-placeholder">{label}</div>
    </div>
  );
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
  /**
   * Custom Puck field for image-URL props (Image, card image, avatar, og:image).
   * The admin injects a Media Library picker; the public site never passes it,
   * so it falls back to a plain text URL input there.
   */
  imageField?: Field;
  /** Renders an embedded navigation menu by id — web injects <PageMenu>. */
  menuComponent?: React.ComponentType<{ menuId: string }>;
  /** Custom Puck field for the Menu block's `menuId` (admin injects a dropdown). */
  menuField?: Field;
  /**
   * Custom Puck field for CSS-color props in the Design group (admin injects a
   * clearable swatch picker). Public surfaces fall back to a text input.
   */
  colorField?: Field;
  /**
   * Which document this config edits. Popups have no SEO surface, so
   * surface:"popup" removes the root SEO fields from the right rail.
   */
  surface?: "page" | "popup";
  /**
   * Admin editors only: skin the canvas like the REAL render target instead of
   * inheriting the admin chrome theme — pages get the member site's dark CMS
   * skin, popups get the white popup box. The matching CSS lives in the
   * admin's puck-theme.css; public surfaces never set this.
   */
  editorCanvas?: boolean;
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
  // Image-URL fields use the injected Media Library picker when provided, else a
  // plain text input (keeps the public <Render> free of admin-only components).
  const imageField = (label: string): Field =>
    opts.imageField
      ? ({ ...opts.imageField, label } as Field)
      : { type: "text", label };
  const MenuComponent = opts.menuComponent;
  const menuField: Field =
    opts.menuField ?? { type: "text", label: "Menu ID (from the Menus tab)" };
  const colorField = (label: string): Field =>
    opts.colorField
      ? ({ ...opts.colorField, label } as Field)
      : { type: "text", label: `${label} (CSS color)` };

  // The Elementor-style per-block design group, shared by every block.
  const designField: Field = {
    type: "object",
    label: "Design (spacing, colors, visibility)",
    objectFields: {
      textColor: colorField("Text color"),
      background: colorField("Background"),
      paddingY: { type: "number", label: "Padding top/bottom (px)", min: 0, max: 300 },
      paddingX: { type: "number", label: "Padding left/right (px)", min: 0, max: 200 },
      marginTop: { type: "number", label: "Space above (px)", min: 0, max: 300 },
      marginBottom: { type: "number", label: "Space below (px)", min: 0, max: 300 },
      radius: { type: "number", label: "Corner radius (px)", min: 0, max: 80 },
      shadow: {
        type: "select",
        label: "Shadow",
        options: [
          { label: "None", value: "" },
          { label: "Soft", value: "soft" },
          { label: "Medium", value: "medium" },
          { label: "Large", value: "large" },
        ],
      },
      fontSize: { type: "number", label: "Font size (px, 0 = default)", min: 0, max: 120 },
      hideOn: {
        type: "select",
        label: "Hide on",
        options: [
          { label: "Never", value: "" },
          { label: "Mobile", value: "mobile" },
          { label: "Desktop", value: "desktop" },
        ],
      },
      animation: {
        type: "select",
        label: "Entrance animation",
        options: [
          { label: "None", value: "" },
          { label: "Fade in", value: "fade" },
          { label: "Rise up", value: "rise" },
          { label: "Zoom in", value: "zoom" },
        ],
      },
      anchorId: { type: "text", label: "Anchor ID (for #links)" },
    },
  };
  const DESIGN_DEFAULT: DesignProps = {};

  return {
    root: {
      // Popups have no SEO surface — hide the page-only root fields there.
      fields:
        opts.surface === "popup"
          ? {}
          : {
              seoTitle: { type: "text", label: "SEO title (optional override)" },
              description: { type: "textarea", label: "Meta description" },
              ogImage: imageField("Social share image URL"),
            },
      defaultProps: { seoTitle: "", description: "", ogImage: "" },
      // Wrap all page content so block CSS variables + base styles apply in
      // BOTH the editor canvas and the public <Render> output. In the admin
      // editor the canvas additionally carries the render target's skin.
      render: ({ children }) => (
        <div
          className={cx(
            "lmspb-root",
            opts.editorCanvas &&
              (opts.surface === "popup"
                ? "lmspb-canvas-popup"
                : "lmspb-dark lmspb-canvas-page"),
          )}
        >
          {children}
        </div>
      ),
    },

    categories: {
      sections: {
        title: "Sections",
        components: ["Hero", "CTA", "Cards", "Stats", "FAQ", "Testimonial"],
      },
      layout: {
        title: "Layout",
        components: ["Section", "Columns", "Spacer", "Divider"],
      },
      content: {
        title: "Content",
        components: [
          "Heading",
          "RichText",
          "Image",
          "Button",
          "Video",
          "IconList",
          "Embed",
          "Form",
          "Menu",
        ],
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
          design: designField,
        },
        defaultProps: {
          eyebrow: "",
          title: "Your headline goes here",
          subtitle: "A short supporting sentence that explains the value.",
          buttonLabel: "Get started",
          buttonHref: "#",
          align: "center",
          background: "muted",
          design: DESIGN_DEFAULT,
        },
        render: ({ eyebrow, title, subtitle, buttonLabel, buttonHref, align, background, design }) => (
          <Designed d={design} ownBackground>
            <section className={cx("lmspb-section", bgClass(background))} style={bandBg(design)}>
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
          </Designed>
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
          design: designField,
        },
        defaultProps: { text: "Section heading", level: "2", align: "left", design: DESIGN_DEFAULT },
        render: ({ text, level, align, design }) => {
          const Tag = (`h${level}` as unknown) as keyof JSX.IntrinsicElements;
          return (
            <Designed d={design}>
              <div className={cx("lmspb-container", "lmspb-w-normal")}>
                <Tag className={cx("lmspb-heading", `lmspb-al-${align}`)}>{text}</Tag>
              </div>
            </Designed>
          );
        },
      },

      // ---------------- Rich text ----------------
      RichText: {
        label: "Rich text",
        fields: {
          html: richTextField,
          align: { type: "radio", options: ALIGN_OPTIONS },
          design: designField,
        },
        defaultProps: { html: "<p>Write something compelling…</p>", align: "left", design: DESIGN_DEFAULT },
        render: ({ html, align, design }) => (
          <Designed d={design}>
            <div className={cx("lmspb-container", "lmspb-w-normal")}>
              <div
                className={cx("lmspb-richtext", `lmspb-al-${align}`)}
                // Sanitized server-side on write (sanitize-html in the API).
                dangerouslySetInnerHTML={{ __html: html || "" }}
              />
            </div>
          </Designed>
        ),
      },

      // ---------------- Image ----------------
      Image: {
        label: "Image",
        fields: {
          src: imageField("Image URL"),
          alt: { type: "text", label: "Alt text" },
          width: { type: "select", options: [
            { label: "Normal", value: "normal" },
            { label: "Wide", value: "wide" },
            { label: "Full width", value: "full" },
          ] },
          rounded: { type: "radio", options: BOOL_OPTIONS },
          caption: { type: "text", label: "Caption" },
          design: designField,
        },
        defaultProps: { src: "", alt: "", width: "normal", rounded: true, caption: "", design: DESIGN_DEFAULT },
        render: ({ src, alt, width, rounded, caption, design, puck }) => {
          if (!src) {
            return puck?.isEditing ? (
              <EmptyHint label="Image — choose one in the field panel" />
            ) : (
              <></>
            );
          }
          return (
            <Designed d={design}>
              <div className={cx("lmspb-container", "lmspb-w-wide")}>
                <figure className="lmspb-figure">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt={alt || ""}
                    className={cx("lmspb-img", `lmspb-img-${width}`, rounded && "lmspb-img-rounded")}
                  />
                  {caption ? <figcaption className="lmspb-caption">{caption}</figcaption> : null}
                </figure>
              </div>
            </Designed>
          );
        },
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
          design: designField,
        },
        defaultProps: { label: "Click me", href: "#", variant: "primary", align: "left", newTab: false, design: DESIGN_DEFAULT },
        render: ({ label, href, variant, align, newTab, design }) => (
          <Designed d={design}>
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
          </Designed>
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
          design: designField,
        },
        defaultProps: { background: "none", paddingY: 48, maxWidth: "normal", content: [], design: DESIGN_DEFAULT },
        render: ({ background, paddingY, maxWidth, content: Content, design }) => (
          <Designed d={design} ownBackground>
            <section
              className={cx("lmspb-section", bgClass(background))}
              style={{
                paddingTop: `${paddingY}px`,
                paddingBottom: `${paddingY}px`,
                ...bandBg(design),
              }}
            >
              <div className={cx("lmspb-container", widthClass(maxWidth))}>
                <Content />
              </div>
            </section>
          </Designed>
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
          design: designField,
        },
        defaultProps: { columns: "2", gap: 24, content: [], design: DESIGN_DEFAULT },
        render: ({ columns, gap, content: Content, design }) => (
          <Designed d={design}>
            <div className={cx("lmspb-container", "lmspb-w-normal")}>
              <Content
                className="lmspb-grid"
                style={{ gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: `${gap}px` }}
              />
            </div>
          </Designed>
        ),
      },

      // ---------------- Video ----------------
      Video: {
        label: "Video",
        fields: {
          url: { type: "text", label: "YouTube / Vimeo / MP4 URL" },
          caption: { type: "text", label: "Caption" },
          design: designField,
        },
        defaultProps: { url: "", caption: "", design: DESIGN_DEFAULT },
        render: ({ url, caption, design, puck }) => {
          const embed = toEmbed(url);
          if (!embed) {
            return puck?.isEditing ? (
              <EmptyHint label="Video — paste a YouTube / Vimeo / MP4 URL in the field panel" />
            ) : (
              <></>
            );
          }
          return (
            <Designed d={design}>
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
            </Designed>
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
              imageUrl: imageField("Image URL"),
              title: { type: "text", label: "Title" },
              text: { type: "textarea", label: "Text" },
              href: { type: "text", label: "Link (optional)" },
            },
            defaultItemProps: { title: "Card title", text: "Card description", imageUrl: "", href: "" },
          },
          design: designField,
        },
        defaultProps: {
          columns: "3",
          items: [
            { title: "First", text: "Describe a feature or benefit." },
            { title: "Second", text: "Describe a feature or benefit." },
            { title: "Third", text: "Describe a feature or benefit." },
          ],
          design: DESIGN_DEFAULT,
        },
        render: ({ columns, items, design }) => (
          <Designed d={design}>
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
          </Designed>
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
          design: designField,
        },
        defaultProps: {
          title: "Ready to get started?",
          subtitle: "Join today and get instant access.",
          buttonLabel: "Join now",
          buttonHref: "#",
          background: "brand",
          align: "center",
          design: DESIGN_DEFAULT,
        },
        render: ({ title, subtitle, buttonLabel, buttonHref, background, align, design }) => (
          <Designed d={design} ownBackground>
            <div className={cx("lmspb-container", "lmspb-w-normal")}>
              <div
                className={cx("lmspb-section", bgClass(background), "lmspb-cta", `lmspb-al-${align}`)}
                style={bandBg(design)}
              >
                <div className={cx("lmspb-container", "lmspb-w-narrow")}>
                  <h2 className="lmspb-cta-title">{title}</h2>
                  {subtitle ? <p className="lmspb-cta-sub">{subtitle}</p> : null}
                  <div className={cx("lmspb-actions", `lmspb-al-${align}`)}>
                    <a className="lmspb-btn lmspb-btn-primary" href={buttonHref || "#"}>{buttonLabel}</a>
                  </div>
                </div>
              </div>
            </div>
          </Designed>
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
          design: designField,
        },
        defaultProps: {
          items: [
            { question: "How does it work?", answer: "Explain it here." },
            { question: "Can I cancel anytime?", answer: "Yes, anytime." },
          ],
          design: DESIGN_DEFAULT,
        },
        render: ({ items, design }) => (
          <Designed d={design}>
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
          </Designed>
        ),
      },

      // ---------------- Testimonial ----------------
      Testimonial: {
        label: "Testimonial",
        fields: {
          quote: { type: "textarea", label: "Quote" },
          author: { type: "text", label: "Author" },
          role: { type: "text", label: "Role / company" },
          avatarUrl: imageField("Avatar URL"),
          design: designField,
        },
        defaultProps: {
          quote: "This product changed how we work. Highly recommended.",
          author: "Jane Doe",
          role: "Founder, Acme",
          avatarUrl: "",
          design: DESIGN_DEFAULT,
        },
        render: ({ quote, author, role, avatarUrl, design }) => (
          <Designed d={design}>
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
          </Designed>
        ),
      },

      // ---------------- Divider ----------------
      Divider: {
        label: "Divider",
        fields: {
          width: { type: "select", options: [
            { label: "Narrow", value: "narrow" },
            { label: "Normal", value: "normal" },
            { label: "Full", value: "full" },
          ] },
          thickness: { type: "number", label: "Thickness (px)", min: 1, max: 12 },
          style: { type: "select", options: [
            { label: "Solid", value: "solid" },
            { label: "Dashed", value: "dashed" },
            { label: "Dotted", value: "dotted" },
          ] },
          color: colorField("Line color"),
          design: designField,
        },
        defaultProps: { width: "normal", thickness: 1, style: "solid", color: "", design: DESIGN_DEFAULT },
        render: ({ width, thickness, style, color, design }) => (
          <Designed d={design}>
            <div className={cx("lmspb-container", widthClass(width))}>
              <hr
                className="lmspb-divider"
                style={{
                  borderTopWidth: `${Math.max(1, Number(thickness) || 1)}px`,
                  borderTopStyle: style || "solid",
                  borderTopColor: color || "var(--lmspb-border)",
                }}
              />
            </div>
          </Designed>
        ),
      },

      // ---------------- Icon list ----------------
      IconList: {
        label: "Icon list",
        fields: {
          icon: { type: "select", label: "Icon", options: [
            { label: "Checkmark", value: "check" },
            { label: "Star", value: "star" },
            { label: "Arrow", value: "arrow" },
            { label: "Dot", value: "dot" },
            { label: "Cross", value: "cross" },
          ] },
          columns: { type: "radio", options: [
            { label: "1 column", value: "1" },
            { label: "2 columns", value: "2" },
          ] },
          iconColor: colorField("Icon color"),
          items: {
            type: "array",
            label: "Items",
            getItemSummary: (item: IconListItem, i) => item?.text || `Item ${(i ?? 0) + 1}`,
            arrayFields: { text: { type: "text", label: "Text" } },
            defaultItemProps: { text: "List item" },
          },
          design: designField,
        },
        defaultProps: {
          icon: "check",
          columns: "1",
          iconColor: "",
          items: [
            { text: "First benefit" },
            { text: "Second benefit" },
            { text: "Third benefit" },
          ],
          design: DESIGN_DEFAULT,
        },
        render: ({ icon, columns, iconColor, items, design }) => (
          <Designed d={design}>
            <div className={cx("lmspb-container", "lmspb-w-normal")}>
              <ul className={cx("lmspb-iconlist", columns === "2" && "lmspb-iconlist-2")}>
                {(items || []).map((it, i) => (
                  <li key={i} className="lmspb-iconlist-item">
                    <span className="lmspb-iconlist-icon">
                      <ListIcon icon={icon} color={iconColor} />
                    </span>
                    <span>{it.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Designed>
        ),
      },

      // ---------------- Stats ----------------
      Stats: {
        label: "Stats",
        fields: {
          columns: { type: "select", options: [
            { label: "2 columns", value: "2" },
            { label: "3 columns", value: "3" },
            { label: "4 columns", value: "4" },
          ] },
          items: {
            type: "array",
            label: "Stats",
            getItemSummary: (item: StatItem, i) => item?.label || `Stat ${(i ?? 0) + 1}`,
            arrayFields: {
              value: { type: "text", label: "Value (e.g. 10,000+)" },
              label: { type: "text", label: "Label" },
            },
            defaultItemProps: { value: "100+", label: "Happy members" },
          },
          design: designField,
        },
        defaultProps: {
          columns: "3",
          items: [
            { value: "10,000+", label: "Students" },
            { value: "4.9★", label: "Average rating" },
            { value: "120+", label: "Lessons" },
          ],
          design: DESIGN_DEFAULT,
        },
        render: ({ columns, items, design }) => (
          <Designed d={design}>
            <div className={cx("lmspb-container", "lmspb-w-normal")}>
              <div className="lmspb-stats" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
                {(items || []).map((it, i) => (
                  <div key={i} className="lmspb-stat">
                    <div className="lmspb-stat-value">{it.value}</div>
                    <div className="lmspb-stat-label">{it.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </Designed>
        ),
      },

      // ---------------- Embed (custom HTML) ----------------
      Embed: {
        label: "Custom HTML",
        fields: {
          // Named `html` ON PURPOSE: the API sanitizes every `html` prop in the
          // document on write (scripts/iframes stripped) — same policy as RichText.
          html: { type: "textarea", label: "HTML (scripts are removed on save)" },
          design: designField,
        },
        defaultProps: { html: "", design: DESIGN_DEFAULT },
        render: ({ html, design, puck }) => {
          if (!html) {
            return puck?.isEditing ? (
              <EmptyHint label="Custom HTML — paste markup in the field panel" />
            ) : (
              <></>
            );
          }
          return (
            <Designed d={design}>
              <div className={cx("lmspb-container", "lmspb-w-normal")}>
                <div className="lmspb-embed" dangerouslySetInnerHTML={{ __html: html }} />
              </div>
            </Designed>
          );
        },
      },

      // ---------------- Form (Mailchimp-linked) ----------------
      Form: {
        label: "Form",
        fields: {
          formId: formField,
        },
        defaultProps: { formId: "" },
        render: ({ formId, puck }) => {
          if (FormComponent && formId) return <FormComponent formId={formId} />;
          if (!puck?.isEditing && !formId) return <></>; // unconfigured: hidden on the site
          return (
            <EmptyHint
              label={formId ? `Form: ${formId}` : "Form — pick one in the field panel"}
            />
          );
        },
      },

      // ---------------- Menu (embedded navigation) ----------------
      Menu: {
        label: "Menu",
        fields: { menuId: menuField },
        defaultProps: { menuId: "" },
        render: ({ menuId, puck }) => {
          if (MenuComponent && menuId) return <MenuComponent menuId={menuId} />;
          if (!puck?.isEditing && !menuId) return <></>; // unconfigured: hidden on the site
          return (
            <EmptyHint
              label={menuId ? `Menu: ${menuId}` : "Menu — pick one in the field panel"}
            />
          );
        },
      },
    },
  };
}
