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
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import RenderHtml from "react-native-render-html";
import { WebView } from "react-native-webview";
import { ResizeMode, Video } from "expo-av";
import type { PagePublicDTO, PuckComponentData, PuckDocument } from "@lms/types";

import { api } from "../api";
import { Loading, ErrorState } from "./Screen";
import { spacing } from "../theme";
import type { Theme, ThemePalette } from "../theme";
import { useStyles, useTheme } from "../theme-provider";

type Props = Record<string, any>;

// ---------- helpers ----------
function bgColor(colors: ThemePalette, bg?: string): string | undefined {
  switch (bg) {
    case "muted":
      return colors.surface;
    case "dark":
      return "#0b1220";
    case "brand":
      return colors.primary;
    default:
      return undefined;
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
function openHref(href?: string) {
  if (!href) return;
  // Only external schemes can be opened from here; in-app routes are app-specific.
  if (/^(https?:|mailto:|tel:)/i.test(href)) Linking.openURL(href).catch(() => {});
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
  return { kind: "iframe", src: u };
}

// Dark-theme styles for rendered rich-text HTML (mirrors BlogPostScreen).
const makeHtmlTagsStyles = ({ colors }: Theme): any => ({
  body: { color: colors.text, fontSize: 16, lineHeight: 24 },
  p: { marginTop: 0, marginBottom: spacing.md },
  h1: { color: colors.text, fontSize: 22, fontWeight: "700", marginBottom: spacing.sm },
  h2: { color: colors.text, fontSize: 20, fontWeight: "700", marginTop: spacing.md, marginBottom: spacing.sm },
  h3: { color: colors.text, fontSize: 18, fontWeight: "700", marginTop: spacing.md, marginBottom: spacing.sm },
  a: { color: colors.primary, textDecorationLine: "underline" },
  li: { color: colors.text, marginBottom: spacing.xs },
  strong: { fontWeight: "700" },
  em: { fontStyle: "italic" },
  blockquote: {
    borderLeftWidth: 3,
    borderLeftColor: colors.border,
    paddingLeft: spacing.md,
    marginLeft: 0,
    marginBottom: spacing.md,
    color: colors.textMuted,
  },
  img: { borderRadius: 8 },
});

// ---------- leaf components ----------
function BlockImage({ uri, rounded }: { uri: string; rounded?: boolean }) {
  const styles = useStyles(makeStyles);
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
  const styles = useStyles(makeStyles);
  const variantStyle =
    p.variant === "secondary"
      ? styles.btnSecondary
      : p.variant === "outline"
      ? styles.btnOutline
      : styles.btnPrimary;
  const textStyle = p.variant === "outline" ? styles.btnTextOutline : styles.btnText;
  return (
    <View style={{ alignItems: alignItems(p.align) }}>
      <TouchableOpacity
        style={[styles.btn, variantStyle]}
        activeOpacity={0.85}
        onPress={() => openHref(p.href)}
      >
        <Text style={textStyle}>{p.label}</Text>
      </TouchableOpacity>
    </View>
  );
}

function FaqRow({ q, a }: { q: string; a: string }) {
  const styles = useStyles(makeStyles);
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
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const bg = bgColor(colors, p.background);
  return (
    <View
      style={[
        styles.bandPad,
        bg ? { backgroundColor: bg, borderRadius: 14 } : null,
        { alignItems: alignItems(p.align) },
      ]}
    >
      {p.eyebrow ? <Text style={styles.eyebrow}>{String(p.eyebrow).toUpperCase()}</Text> : null}
      <Text style={[styles.heroTitle, { textAlign: textAlign(p.align) }]}>{p.title}</Text>
      {p.subtitle ? (
        <Text style={[styles.heroSub, { textAlign: textAlign(p.align) }]}>{p.subtitle}</Text>
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
  const styles = useStyles(makeStyles);
  const size = p.level === "1" ? 28 : p.level === "2" ? 24 : p.level === "3" ? 20 : 18;
  return <Text style={[styles.heading, { fontSize: size, textAlign: textAlign(p.align) }]}>{p.text}</Text>;
}

function RichTextBlock(p: Props) {
  const htmlTagsStyles = useStyles(makeHtmlTagsStyles);
  const { width } = useWindowDimensions();
  return (
    <RenderHtml
      contentWidth={Math.max(0, width - spacing.md * 2)}
      source={{ html: p.html || "<p></p>" }}
      tagsStyles={htmlTagsStyles}
      defaultTextProps={{ selectable: true }}
    />
  );
}

function ImageBlock(p: Props) {
  const styles = useStyles(makeStyles);
  return (
    <View>
      <BlockImage uri={p.src} rounded={p.rounded} />
      {p.caption ? <Text style={styles.caption}>{p.caption}</Text> : null}
    </View>
  );
}

function SectionBlock(p: Props) {
  const { colors } = useTheme();
  const bg = bgColor(colors, p.background);
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
  const styles = useStyles(makeStyles);
  const embed = toEmbed(p.url);
  return (
    <View>
      <View style={styles.video}>
        {embed?.kind === "video" ? (
          <Video
            style={StyleSheet.absoluteFill}
            source={{ uri: embed.src }}
            useNativeControls
            resizeMode={ResizeMode.CONTAIN}
          />
        ) : embed ? (
          <WebView
            style={StyleSheet.absoluteFill}
            source={{ uri: embed.src }}
            allowsFullscreenVideo
            allowsInlineMediaPlayback
            javaScriptEnabled
            domStorageEnabled
          />
        ) : null}
      </View>
      {p.caption ? <Text style={styles.caption}>{p.caption}</Text> : null}
    </View>
  );
}

function CardsBlock(p: Props) {
  const styles = useStyles(makeStyles);
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
          <TouchableOpacity key={i} style={styles.card} activeOpacity={0.85} onPress={() => openHref(it.href)}>
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
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const bg = bgColor(colors, p.background) ?? colors.primary;
  return (
    <View style={[styles.bandPad, { backgroundColor: bg, borderRadius: 14, alignItems: alignItems(p.align) }]}>
      <Text style={[styles.ctaTitle, { textAlign: textAlign(p.align) }]}>{p.title}</Text>
      {p.subtitle ? <Text style={[styles.ctaSub, { textAlign: textAlign(p.align) }]}>{p.subtitle}</Text> : null}
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
  const styles = useStyles(makeStyles);
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

// ---------- dispatcher ----------
function Block({ item }: { item: PuckComponentData }) {
  const p: Props = (item?.props as Props) ?? {};
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
    default:
      return null;
  }
}

function renderItems(items?: PuckComponentData[]) {
  if (!Array.isArray(items)) return null;
  return items.map((it, i) => <Block key={(it?.props?.id as string) ?? i} item={it} />);
}

// ---------- public API ----------
export function PageRenderer({ data }: { data: PuckDocument }) {
  const styles = useStyles(makeStyles);
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

const makeStyles = ({ colors }: Theme) => StyleSheet.create({
  page: { padding: spacing.md, gap: spacing.md },
  bandPad: { padding: spacing.lg },
  eyebrow: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    marginBottom: spacing.xs,
  },
  heroTitle: { color: colors.text, fontSize: 28, fontWeight: "800", lineHeight: 34 },
  heroSub: { color: colors.textMuted, fontSize: 16, lineHeight: 24, marginTop: spacing.sm },
  heading: { color: colors.text, fontWeight: "800" },
  caption: { color: colors.textMuted, fontSize: 13, textAlign: "center", marginTop: spacing.xs },
  img: { width: "100%", borderRadius: 0, backgroundColor: colors.surfaceMuted },
  imgRounded: { borderRadius: 12 },
  btn: { borderRadius: 999, paddingVertical: 12, paddingHorizontal: 22, alignItems: "center" },
  btnPrimary: { backgroundColor: colors.primary },
  btnSecondary: { backgroundColor: colors.surfaceMuted },
  btnOutline: { borderWidth: 2, borderColor: colors.primary },
  btnText: { color: "#ffffff", fontWeight: "700", fontSize: 15 },
  btnTextOutline: { color: colors.primary, fontWeight: "700", fontSize: 15 },
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
  cardTitle: { color: colors.text, fontSize: 17, fontWeight: "700" },
  cardText: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  ctaTitle: { color: colors.text, fontSize: 22, fontWeight: "800" },
  ctaSub: { color: colors.text, opacity: 0.9, fontSize: 15, marginTop: spacing.xs },
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
  faqQ: { color: colors.text, fontSize: 15, fontWeight: "600", flex: 1, paddingRight: spacing.sm },
  faqToggle: { color: colors.textMuted, fontSize: 20, fontWeight: "700" },
  faqA: { color: colors.textMuted, fontSize: 14, lineHeight: 20, paddingBottom: spacing.md },
  quote: {
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    paddingLeft: spacing.md,
  },
  quoteText: { color: colors.text, fontSize: 18, fontStyle: "italic", lineHeight: 26, marginBottom: spacing.md },
  quoteByRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  quoteAvatar: { width: 44, height: 44, borderRadius: 999, backgroundColor: colors.surfaceMuted },
  quoteAuthor: { color: colors.text, fontWeight: "700" },
  quoteRole: { color: colors.textMuted, fontSize: 13 },
});
