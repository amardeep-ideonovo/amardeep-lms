// Native React Native renderer for CMS pages authored in the admin (Puck).
//
// The page is a portable JSON document (PuckDocument). The admin web editor and
// the public web site render it via Puck's React-DOM <Render>; that can't run
// in React Native, so this maps the SAME block JSON to native components.
//
//   <PageEmbed slug="about" />   // fetch + render, drop into any screen
//   <PageRenderer data={doc} />  // render an already-loaded document
//
// Blocks nested in slots (Section/Columns) live in props.content and render
// recursively. Unknown block types are skipped (forward-compatible).
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import type {
  PagePublicDTO,
  PuckComponentData,
  PuckDocument,
  ResolvedMenu,
  ResolvedMenuItem,
} from "@lms/types";

import { api } from "../api";
import { FormEmbed } from "./FormEmbed";
import { HtmlView } from "./HtmlView";
import { Loading, ErrorState } from "./Screen";
import { VideoPlayerView } from "./VideoPlayerView";
import {
  openHref,
  useInteraction,
  useScopedStyles,
  useScopedTheme,
} from "./PageScope";
import { spacing } from "../theme";
import type { Theme, ThemePalette } from "../theme";

type Props = Record<string, any>;

// ---------- per-block design overrides (subset of the web editor's group) ----------
// The admin's Design group carries web-only typography/animation too; natively
// we honor the layout subset — background, padding, margins, radius, text
// color/size on the wrapper's cascade-free equivalents are web-only — and the
// hide-per-device switch (hideOn:"mobile" suppresses the block here, while
// hideOn:"desktop" blocks render ONLY here).
type BlockDesign = {
  background?: string;
  paddingY?: number;
  paddingX?: number;
  marginTop?: number;
  marginBottom?: number;
  radius?: number;
  hideOn?: string;
};

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;

// RN can't paint CSS gradients/images — only accept plain color syntaxes here;
// anything else (e.g. "linear-gradient(...)") falls back to the theme surface.
function asNativeColor(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const c = v.trim();
  return /^(#|rgb|hsl)/i.test(c) || /^[a-z]+$/i.test(c) ? c : undefined;
}

// `ownBackground` mirrors the web wrapper: the band blocks (Hero/CTA/Section)
// paint design.background on their own band, so the wrapper must not.
function designViewStyle(d?: BlockDesign, ownBackground = false): object | null {
  if (!d || typeof d !== "object") return null;
  const s: Record<string, unknown> = {};
  const bg = ownBackground ? undefined : asNativeColor(d.background);
  if (bg) s.backgroundColor = bg;
  const py = num(d.paddingY);
  if (py !== undefined) s.paddingVertical = py;
  const px = num(d.paddingX);
  if (px !== undefined) s.paddingHorizontal = px;
  const mt = num(d.marginTop);
  if (mt !== undefined) s.marginTop = mt;
  const mb = num(d.marginBottom);
  if (mb !== undefined) s.marginBottom = mb;
  const r = num(d.radius);
  if (r !== undefined) {
    s.borderRadius = r;
    s.overflow = "hidden";
  }
  return Object.keys(s).length ? s : null;
}

// ---------- helpers ----------
function bgColor(colors: ThemePalette, bg?: string): string | undefined {
  switch (bg) {
    case "muted":
      return colors.surface;
    case "dark":
      // CMS "dark" bands render as the Ink Hero chrome so page sections match
      // the app's band treatment.
      return colors.chrome;
    case "brand":
      return colors.primary;
    default:
      return undefined;
  }
}
// Text color forced by a band background (mirrors the web CSS, where dark and
// brand bands always get light-on-dark treatment regardless of page theme —
// without this, light mode would paint near-black text on the dark band).
function bandText(colors: ThemePalette, bg?: string): string | undefined {
  switch (bg) {
    case "dark":
      return "#f8fafc";
    case "brand":
      return colors.onPrimary;
    default:
      return undefined; // none/muted: the normal theme text already reads fine
  }
}
function alignItems(align?: string): "flex-start" | "center" | "flex-end" {
  return align === "center"
    ? "center"
    : align === "right"
    ? "flex-end"
    : "flex-start";
}
function textAlign(align?: string): "left" | "center" | "right" {
  return align === "center" ? "center" : align === "right" ? "right" : "left";
}
function toEmbed(url?: string): { kind: "iframe" | "video"; src: string } | null {
  if (!url) return null;
  const u = url.trim();
  const yt = u.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/
  );
  if (yt) return { kind: "iframe", src: `https://www.youtube.com/embed/${yt[1]}` };
  const vimeo = u.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeo) return { kind: "iframe", src: `https://player.vimeo.com/video/${vimeo[1]}` };
  if (/\.(mp4|webm|ogg)(\?.*)?$/i.test(u)) return { kind: "video", src: u };
  // No fallthrough: only KNOWN embed hosts (YouTube/Vimeo) or a direct video
  // file are rendered. An arbitrary CMS-authored URL must NOT load in a
  // JS-enabled WebView (it could serve an in-app phishing/exfil page).
  return null;
}

// ---------- leaf components ----------
function BlockImage({ uri, rounded }: { uri: string; rounded?: boolean }) {
  const styles = useScopedStyles(makeStyles);
  const [ratio, setRatio] = useState(16 / 9);
  useEffect(() => {
    if (!uri) return;
    let alive = true;
    Image.getSize(
      uri,
      (w, h) => {
        if (alive && w && h) setRatio(w / h);
      },
      () => {}
    );
    return () => {
      alive = false;
    };
  }, [uri]);
  if (!uri) return null;
  return (
    <Image
      source={{ uri }}
      style={[styles.img, { aspectRatio: ratio }, rounded ? styles.imgRounded : null]}
      resizeMode="cover"
    />
  );
}

function BlockButton(p: Props) {
  const styles = useScopedStyles(makeStyles);
  const onInteract = useInteraction();
  const variantStyle =
    p.variant === "secondary"
      ? styles.btnSecondary
      : p.variant === "outline"
      ? styles.btnOutline
      : styles.btnPrimary;
  const textStyle =
    p.variant === "outline"
      ? styles.btnTextOutline
      : p.variant === "secondary"
      ? styles.btnTextSecondary
      : styles.btnText;
  return (
    <View style={{ alignItems: alignItems(p.align) }}>
      <TouchableOpacity
        style={[styles.btn, variantStyle]}
        activeOpacity={0.85}
        onPress={() => {
          onInteract?.();
          openHref(p.href);
        }}
      >
        <Text style={textStyle}>{p.label}</Text>
      </TouchableOpacity>
    </View>
  );
}

function FaqRow({ q, a }: { q: string; a: string }) {
  const styles = useScopedStyles(makeStyles);
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.faqItem}>
      <TouchableOpacity
        style={styles.faqHead}
        activeOpacity={0.7}
        onPress={() => setOpen((o) => !o)}
      >
        <Text style={styles.faqQ}>{q}</Text>
        <Text style={styles.faqToggle}>{open ? "–" : "+"}</Text>
      </TouchableOpacity>
      {open ? <Text style={styles.faqA}>{a}</Text> : null}
    </View>
  );
}

// ---------- block components ----------
function HeroBlock(p: Props) {
  const styles = useScopedStyles(makeStyles);
  const { colors } = useScopedTheme();
  const d = (p.design ?? {}) as Props;
  const customBg =
    p.background === "custom" ? asNativeColor(p.backgroundColor) : undefined;
  const bg = customBg ?? asNativeColor(d.background) ?? bgColor(colors, p.background);
  const band = asNativeColor(d.textColor) ?? bandText(colors, p.background);
  return (
    <View
      style={[
        styles.bandPad,
        bg ? { backgroundColor: bg, borderRadius: 14 } : null,
        { alignItems: alignItems(p.align) },
      ]}
    >
      {p.eyebrow ? (
        <Text style={[styles.eyebrow, band ? { color: band, opacity: 0.8 } : null]}>
          {String(p.eyebrow).toUpperCase()}
        </Text>
      ) : null}
      <Text
        style={[
          styles.heroTitle,
          { textAlign: textAlign(p.align) },
          band ? { color: band } : null,
        ]}
      >
        {p.title}
      </Text>
      {p.subtitle ? (
        <Text
          style={[
            styles.heroSub,
            { textAlign: textAlign(p.align) },
            band ? { color: band, opacity: 0.85 } : null,
          ]}
        >
          {p.subtitle}
        </Text>
      ) : null}
      {p.buttonLabel ? (
        <View style={{ marginTop: spacing.md, alignSelf: "stretch" }}>
          <BlockButton label={p.buttonLabel} href={p.buttonHref} variant="primary" align={p.align} />
        </View>
      ) : null}
    </View>
  );
}

function HeadingBlock(p: Props) {
  const styles = useScopedStyles(makeStyles);
  const size = p.level === "1" ? 28 : p.level === "2" ? 24 : p.level === "3" ? 20 : 18;
  return <Text style={[styles.heading, { fontSize: size, textAlign: textAlign(p.align) }]}>{p.text}</Text>;
}

function RichTextBlock(p: Props) {
  const onInteract = useInteraction();
  const { width } = useWindowDimensions();
  return (
    <HtmlView
      html={p.html || "<p></p>"}
      contentWidth={Math.max(0, width - spacing.md * 2)}
      // Inside a popup, anchor taps count as engagement (web parity); outside,
      // onInteract is null and links just open.
      onLinkPress={(href) => {
        onInteract?.();
        openHref(href);
      }}
    />
  );
}

function ImageBlock(p: Props) {
  const styles = useScopedStyles(makeStyles);
  return (
    <View>
      <BlockImage uri={p.src} rounded={p.rounded} />
      {p.caption ? <Text style={styles.caption}>{p.caption}</Text> : null}
    </View>
  );
}

function SectionBlock(p: Props) {
  const { colors } = useScopedTheme();
  const bg =
    (p.background === "custom" ? asNativeColor(p.backgroundColor) : undefined) ??
    asNativeColor((p.design as Props | undefined)?.background) ??
    bgColor(colors, p.background);
  return (
    <View
      style={[
        { paddingVertical: Number(p.paddingY) || spacing.md, gap: spacing.md },
        bg ? { backgroundColor: bg, borderRadius: 14, paddingHorizontal: spacing.md } : null,
      ]}
    >
      {renderItems(p.content)}
    </View>
  );
}

function ColumnsBlock(p: Props) {
  // On phones, columns stack vertically.
  return <View style={{ gap: Number(p.gap) || spacing.md }}>{renderItems(p.content)}</View>;
}

function VideoBlock(p: Props) {
  const styles = useScopedStyles(makeStyles);
  const embed = toEmbed(p.url);
  return (
    <View>
      <View style={styles.video}>
        {embed?.kind === "video" ? (
          <VideoPlayerView style={StyleSheet.absoluteFill} uri={embed.src} />
        ) : embed ? (
          <WebView
            style={StyleSheet.absoluteFill}
            source={{ uri: embed.src }}
            allowsFullscreenVideo
            allowsInlineMediaPlayback
            javaScriptEnabled
            domStorageEnabled
            // toEmbed only yields youtube.com/embed or player.vimeo.com URLs;
            // restrict navigation to those families and block popup windows as
            // defense-in-depth (kept lenient enough not to break the players).
            originWhitelist={["https://*.youtube.com", "https://*.vimeo.com"]}
            setSupportMultipleWindows={false}
          />
        ) : null}
      </View>
      {p.caption ? <Text style={styles.caption}>{p.caption}</Text> : null}
    </View>
  );
}

function CardsBlock(p: Props) {
  const styles = useScopedStyles(makeStyles);
  const onInteract = useInteraction();
  const items: Props[] = Array.isArray(p.items) ? p.items : [];
  return (
    <View style={{ gap: spacing.md }}>
      {items.map((it, i) => {
        const body = (
          <>
            {it.imageUrl ? <BlockImage uri={it.imageUrl} rounded /> : null}
            <Text style={styles.cardTitle}>{it.title}</Text>
            {it.text ? <Text style={styles.cardText}>{it.text}</Text> : null}
          </>
        );
        return it.href ? (
          <TouchableOpacity
            key={i}
            style={styles.card}
            activeOpacity={0.85}
            onPress={() => {
              onInteract?.();
              openHref(it.href);
            }}
          >
            {body}
          </TouchableOpacity>
        ) : (
          <View key={i} style={styles.card}>
            {body}
          </View>
        );
      })}
    </View>
  );
}

function CtaBlock(p: Props) {
  const styles = useScopedStyles(makeStyles);
  const { colors } = useScopedTheme();
  const d = (p.design ?? {}) as Props;
  const bg =
    (p.background === "custom" ? asNativeColor(p.backgroundColor) : undefined) ??
    asNativeColor(d.background) ??
    bgColor(colors, p.background) ??
    colors.primary;
  // The CTA band defaults to the primary color, so its text follows the band,
  // not the page theme (otherwise light mode paints dark text on indigo).
  const txt =
    asNativeColor(d.textColor) ??
    (p.background === "muted"
      ? colors.text
      : bandText(colors, p.background) ?? colors.onPrimary);
  return (
    <View style={[styles.bandPad, { backgroundColor: bg, borderRadius: 14, alignItems: alignItems(p.align) }]}>
      <Text style={[styles.ctaTitle, { color: txt, textAlign: textAlign(p.align) }]}>{p.title}</Text>
      {p.subtitle ? (
        <Text style={[styles.ctaSub, { color: txt, textAlign: textAlign(p.align) }]}>{p.subtitle}</Text>
      ) : null}
      {p.buttonLabel ? (
        <View style={{ marginTop: spacing.md, alignSelf: "stretch" }}>
          <BlockButton label={p.buttonLabel} href={p.buttonHref} variant="secondary" align={p.align} />
        </View>
      ) : null}
    </View>
  );
}

function FaqBlock(p: Props) {
  const items: Props[] = Array.isArray(p.items) ? p.items : [];
  return (
    <View style={{ gap: spacing.sm }}>
      {items.map((it, i) => (
        <FaqRow key={i} q={it.question} a={it.answer} />
      ))}
    </View>
  );
}

function TestimonialBlock(p: Props) {
  const styles = useScopedStyles(makeStyles);
  return (
    <View style={styles.quote}>
      <Text style={styles.quoteText}>“{p.quote}”</Text>
      <View style={styles.quoteByRow}>
        {p.avatarUrl ? <Image source={{ uri: p.avatarUrl }} style={styles.quoteAvatar} /> : null}
        <View>
          <Text style={styles.quoteAuthor}>{p.author}</Text>
          {p.role ? <Text style={styles.quoteRole}>{p.role}</Text> : null}
        </View>
      </View>
    </View>
  );
}

function DividerBlock(p: Props) {
  const { colors } = useScopedTheme();
  const style = p.style === "dashed" ? "dashed" : p.style === "dotted" ? "dotted" : "solid";
  return (
    <View
      style={{
        borderBottomWidth: Math.max(1, Number(p.thickness) || 1),
        borderStyle: style,
        borderColor:
          typeof p.color === "string" && p.color.trim() ? p.color : colors.border,
      }}
    />
  );
}

// Same glyph semantics as the web's inline SVG set.
const LIST_GLYPHS: Record<string, string> = {
  check: "✓",
  star: "★",
  arrow: "→",
  dot: "•",
  cross: "✕",
};

function IconListBlock(p: Props) {
  const styles = useScopedStyles(makeStyles);
  const { colors } = useScopedTheme();
  const items: Props[] = Array.isArray(p.items) ? p.items : [];
  const glyph = LIST_GLYPHS[String(p.icon)] ?? LIST_GLYPHS.check;
  const color =
    typeof p.iconColor === "string" && p.iconColor.trim()
      ? p.iconColor
      : colors.primary;
  return (
    <View style={{ gap: spacing.sm }}>
      {items.map((it, i) => (
        <View key={i} style={styles.iconRow}>
          <Text style={[styles.iconGlyph, { color }]}>{glyph}</Text>
          <Text style={styles.iconText}>{it.text}</Text>
        </View>
      ))}
    </View>
  );
}

function StatsBlock(p: Props) {
  const styles = useScopedStyles(makeStyles);
  const items: Props[] = Array.isArray(p.items) ? p.items : [];
  return (
    <View style={styles.statsWrap}>
      {items.map((it, i) => (
        <View key={i} style={styles.stat}>
          <Text style={styles.statValue}>{it.value}</Text>
          <Text style={styles.statLabel}>{it.label}</Text>
        </View>
      ))}
    </View>
  );
}

function EmbedBlock(p: Props) {
  const onInteract = useInteraction();
  const { width } = useWindowDimensions();
  if (!p.html) return null;
  // Sanitized server-side like RichText; HtmlView renders the CMS tag set.
  return (
    <HtmlView
      html={String(p.html)}
      contentWidth={Math.max(0, width - spacing.md * 2)}
      onLinkPress={(href) => {
        onInteract?.();
        openHref(href);
      }}
    />
  );
}

// Depth-first flatten with depth (mirrors web's flattenChildren) so nested
// menu items render as one indented list.
function flattenMenu(
  items: ResolvedMenuItem[],
  depth = 0
): { item: ResolvedMenuItem; depth: number }[] {
  const out: { item: ResolvedMenuItem; depth: number }[] = [];
  for (const it of items) {
    out.push({ item: it, depth });
    out.push(...flattenMenu(it.children, depth + 1));
  }
  return out;
}

function MenuBlock({ menuId }: { menuId: string }) {
  const styles = useScopedStyles(makeStyles);
  const onInteract = useInteraction();
  const [menu, setMenu] = useState<ResolvedMenu | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .resolvedMenu(menuId)
      .then((m) => {
        if (alive) setMenu(m);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [menuId]);

  if (!menu || menu.items.length === 0) return null;

  return (
    <View style={styles.menu}>
      {flattenMenu(menu.items).map(({ item, depth }) => (
        <TouchableOpacity
          key={item.id}
          style={[styles.menuLink, depth ? { marginLeft: depth * spacing.md } : null]}
          activeOpacity={0.7}
          onPress={() => {
            onInteract?.();
            openHref(item.href);
          }}
        >
          <Text style={styles.menuLinkText}>{item.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ---------- dispatcher ----------
function blockBody(item: PuckComponentData, p: Props): React.ReactElement | null {
  switch (item?.type) {
    case "Hero":
      return <HeroBlock {...p} />;
    case "Heading":
      return <HeadingBlock {...p} />;
    case "RichText":
      return <RichTextBlock {...p} />;
    case "Image":
      return <ImageBlock {...p} />;
    case "Button":
      return <BlockButton {...p} />;
    case "Spacer":
      return <View style={{ height: Number(p.height) || 0 }} />;
    case "Section":
      return <SectionBlock {...p} />;
    case "Columns":
      return <ColumnsBlock {...p} />;
    case "Video":
      return <VideoBlock {...p} />;
    case "Cards":
      return <CardsBlock {...p} />;
    case "CTA":
      return <CtaBlock {...p} />;
    case "FAQ":
      return <FaqBlock {...p} />;
    case "Testimonial":
      return <TestimonialBlock {...p} />;
    case "Divider":
      return <DividerBlock {...p} />;
    case "IconList":
      return <IconListBlock {...p} />;
    case "Stats":
      return <StatsBlock {...p} />;
    case "Embed":
      return <EmbedBlock {...p} />;
    case "Form":
      // Unset id = an unconfigured block; render nothing in the member app.
      return p.formId ? <FormEmbed formId={String(p.formId)} /> : null;
    case "Menu":
      return p.menuId ? <MenuBlock menuId={String(p.menuId)} /> : null;
    default:
      return null;
  }
}

// Band blocks that paint design.background themselves (web parity).
const OWN_BACKGROUND = new Set(["Hero", "CTA", "Section"]);

function Block({ item }: { item: PuckComponentData }) {
  const p: Props = (item?.props as Props) ?? {};
  const design = p.design as BlockDesign | undefined;
  // The admin's hide-per-device switch: "mobile" hides the block here;
  // "desktop" means the block exists FOR this surface.
  if (design?.hideOn === "mobile") return null;
  const body = blockBody(item, p);
  if (!body) return null;
  const style = designViewStyle(design, OWN_BACKGROUND.has(item?.type));
  return style ? <View style={style}>{body}</View> : body;
}

function renderItems(items?: PuckComponentData[]) {
  if (!Array.isArray(items)) return null;
  return items.map((it, i) => <Block key={(it?.props?.id as string) ?? i} item={it} />);
}

// ---------- public API ----------
export function PageRenderer({ data }: { data: PuckDocument }) {
  const styles = useScopedStyles(makeStyles);
  return <View style={styles.page}>{renderItems(data?.content)}</View>;
}

export function PageEmbed({
  slug,
  onLoad,
}: {
  slug: string;
  // Called with the loaded page so a host screen can target popups at it by id
  // (kept in a ref so passing an inline callback never re-triggers the fetch).
  onLoad?: (page: PagePublicDTO) => void;
}) {
  const [data, setData] = useState<PuckDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await api.page(slug);
      setData(page.data);
      onLoadRef.current?.(page);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this page.");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return null;
  return <PageRenderer data={data} />;
}

const makeStyles = ({ colors, fonts }: Theme) => StyleSheet.create({
  page: { padding: spacing.md, gap: spacing.md },
  bandPad: { padding: spacing.lg },
  eyebrow: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "700",
    fontFamily: fonts.bold,
    letterSpacing: 1,
    marginBottom: spacing.xs,
  },
  heroTitle: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "800",
    fontFamily: fonts.display,
    lineHeight: 34,
  },
  heroSub: {
    color: colors.textMuted,
    fontSize: 16,
    lineHeight: 24,
    marginTop: spacing.sm,
    fontFamily: fonts.regular,
  },
  heading: { color: colors.text, fontWeight: "800", fontFamily: fonts.extrabold },
  caption: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: "center",
    marginTop: spacing.xs,
    fontFamily: fonts.regular,
  },
  img: { width: "100%", borderRadius: 0, backgroundColor: colors.surfaceMuted },
  imgRounded: { borderRadius: 12 },
  btn: { borderRadius: 999, paddingVertical: 12, paddingHorizontal: 22, alignItems: "center" },
  btnPrimary: { backgroundColor: colors.primary },
  btnSecondary: { backgroundColor: colors.surfaceMuted },
  btnOutline: { borderWidth: 2, borderColor: colors.primary },
  btnText: { color: colors.onPrimary, fontWeight: "700", fontSize: 15, fontFamily: fonts.bold },
  // Secondary sits on the muted surface, so it follows the theme text (the old
  // hardcoded white was invisible on the light palette's gray).
  btnTextSecondary: { color: colors.text, fontWeight: "700", fontSize: 15, fontFamily: fonts.bold },
  btnTextOutline: { color: colors.primary, fontWeight: "700", fontSize: 15, fontFamily: fonts.bold },
  video: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#000",
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardTitle: { color: colors.text, fontSize: 17, fontWeight: "700", fontFamily: fonts.bold },
  cardText: { color: colors.textMuted, fontSize: 14, lineHeight: 20, fontFamily: fonts.regular },
  ctaTitle: { color: colors.text, fontSize: 22, fontWeight: "800", fontFamily: fonts.display },
  ctaSub: {
    color: colors.text,
    opacity: 0.9,
    fontSize: 15,
    marginTop: spacing.xs,
    fontFamily: fonts.regular,
  },
  faqItem: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
  },
  faqHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
  },
  faqQ: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "600",
    fontFamily: fonts.semibold,
    flex: 1,
    paddingRight: spacing.sm,
  },
  faqToggle: { color: colors.textMuted, fontSize: 20, fontWeight: "700", fontFamily: fonts.bold },
  faqA: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    paddingBottom: spacing.md,
    fontFamily: fonts.regular,
  },
  quote: {
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    paddingLeft: spacing.md,
  },
  quoteText: {
    color: colors.text,
    fontSize: 18,
    fontStyle: "italic",
    lineHeight: 26,
    marginBottom: spacing.md,
    fontFamily: fonts.regular,
  },
  quoteByRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  quoteAvatar: { width: 44, height: 44, borderRadius: 999, backgroundColor: colors.surfaceMuted },
  quoteAuthor: { color: colors.text, fontWeight: "700", fontFamily: fonts.bold },
  quoteRole: { color: colors.textMuted, fontSize: 13, fontFamily: fonts.regular },
  menu: { gap: spacing.xs },
  menuLink: { paddingVertical: spacing.sm, paddingHorizontal: 10, borderRadius: 8 },
  menuLinkText: { color: colors.text, fontSize: 15, fontWeight: "500", fontFamily: fonts.medium },
  iconRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  iconGlyph: { fontSize: 16, fontWeight: "800", fontFamily: fonts.extrabold, lineHeight: 22, width: 20 },
  iconText: { color: colors.text, fontSize: 15, lineHeight: 22, flex: 1, fontFamily: fonts.regular },
  statsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: spacing.md,
  },
  stat: { alignItems: "center", minWidth: "42%", flexGrow: 1 },
  statValue: { color: colors.text, fontSize: 28, fontWeight: "800", fontFamily: fonts.display },
  statLabel: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 2,
    textAlign: "center",
    fontFamily: fonts.regular,
  },
});
