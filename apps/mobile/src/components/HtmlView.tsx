// Minimal native renderer for the sanitized rich-text HTML the CMS produces
// (blog post bodies + RichText page blocks). Replaces react-native-render-html,
// which is unmaintained and broke on React 19. Coverage is exactly the tag set
// the API sanitizer allows; unknown tags render their children so future tags
// degrade to plain content instead of disappearing.
import React, { useEffect, useMemo, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import type { StyleProp, TextStyle } from "react-native";
import { parseDocument } from "htmlparser2";

import { openHref, useScopedStyles } from "./PageScope";
import { spacing } from "../theme";
import type { Theme } from "../theme";

// Structural view of htmlparser2/domhandler nodes — enough for rendering,
// decoupled from the parser's own type exports.
type DomNode = {
  type: string; // "text" | "tag" | ...
  data?: string;
  name?: string;
  attribs?: Record<string, string>;
  children?: DomNode[];
};

export type HtmlViewProps = {
  html: string;
  contentWidth: number; // images render at this width
  baseStyle?: StyleProp<TextStyle>; // merged into every text block
  selectable?: boolean;
  onLinkPress?: (href: string) => void; // default: openHref
};

const INLINE_TAGS = new Set([
  "a",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "code",
  "br",
  "span",
  "sub",
  "sup",
  "mark",
  "small",
]);

const collapse = (s: string) => s.replace(/\s+/g, " ");

function rawText(node: DomNode): string {
  if (node.type === "text") return node.data ?? "";
  return (node.children ?? []).map(rawText).join("");
}

function collectImgs(node: DomNode, out: DomNode[] = []): DomNode[] {
  for (const c of node.children ?? []) {
    if (c.type === "tag" && c.name === "img") out.push(c);
    else collectImgs(c, out);
  }
  return out;
}

type HtmlStyles = ReturnType<typeof makeHtmlStyles>;
type Ctx = {
  s: HtmlStyles;
  baseStyle?: StyleProp<TextStyle>;
  selectable: boolean;
  press: (href: string) => void;
  contentWidth: number;
};

function renderInline(node: DomNode, ctx: Ctx, key: number): React.ReactNode {
  if (node.type === "text") return collapse(node.data ?? "");
  if (node.type !== "tag") return null;
  const kids = (node.children ?? []).map((c, i) => renderInline(c, ctx, i));
  switch (node.name) {
    case "br":
      return "\n";
    case "strong":
    case "b":
      return (
        <Text key={key} style={ctx.s.strong}>
          {kids}
        </Text>
      );
    case "em":
    case "i":
      return (
        <Text key={key} style={ctx.s.em}>
          {kids}
        </Text>
      );
    case "u":
      return (
        <Text key={key} style={ctx.s.u}>
          {kids}
        </Text>
      );
    case "code":
      return (
        <Text key={key} style={ctx.s.code}>
          {kids}
        </Text>
      );
    case "a": {
      const href = node.attribs?.href;
      return (
        <Text
          key={key}
          style={ctx.s.a}
          onPress={href ? () => ctx.press(href) : undefined}
        >
          {kids}
        </Text>
      );
    }
    case "img":
      return null; // images render at block level only
    default:
      return <React.Fragment key={key}>{kids}</React.Fragment>;
  }
}

// Walk a node list: consecutive inline nodes group into one paragraph-style
// <Text>; block elements dispatch to renderBlock. Handles loose text at the
// top level and inline-only blockquote bodies uniformly.
function renderBlocks(nodes: DomNode[], ctx: Ctx): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let run: DomNode[] = [];
  let key = 0;

  const flush = () => {
    if (!run.length) return;
    if (collapse(run.map(rawText).join("")).trim()) {
      out.push(
        <Text
          key={key++}
          selectable={ctx.selectable}
          style={[ctx.s.body, ctx.baseStyle, ctx.s.p]}
        >
          {run.map((n, i) => renderInline(n, ctx, i))}
        </Text>
      );
    }
    run = [];
  };

  for (const node of nodes) {
    const inline =
      node.type === "text" ||
      (node.type === "tag" && INLINE_TAGS.has(node.name ?? ""));
    if (inline) {
      run.push(node);
      continue;
    }
    if (node.type !== "tag") continue; // comments, directives
    flush();
    out.push(renderBlock(node, ctx, key++));
  }
  flush();
  return out;
}

function renderBlock(el: DomNode, ctx: Ctx, key: number): React.ReactNode {
  const s = ctx.s;
  const textBlock = (style: object) => (
    <Text
      key={key}
      selectable={ctx.selectable}
      style={[s.body, ctx.baseStyle, style]}
    >
      {(el.children ?? []).map((c, i) => renderInline(c, ctx, i))}
    </Text>
  );

  switch (el.name) {
    case "p": {
      // Rich-text editors emit images wrapped in a paragraph; an image-only
      // paragraph renders as the image(s), not an empty text block.
      const imgs = collectImgs(el);
      if (imgs.length && !collapse(rawText(el)).trim()) {
        return (
          <View key={key}>
            {imgs.map((img, i) => (
              <HtmlImg
                key={i}
                src={img.attribs?.src ?? ""}
                contentWidth={ctx.contentWidth}
              />
            ))}
          </View>
        );
      }
      return textBlock(s.p);
    }
    case "h1":
      return textBlock(s.h1);
    case "h2":
      return textBlock(s.h2);
    case "h3":
      return textBlock(s.h3);
    case "h4":
    case "h5":
    case "h6":
      return textBlock(s.h4);
    case "ul":
    case "ol": {
      const ordered = el.name === "ol";
      const items = (el.children ?? []).filter(
        (c) => c.type === "tag" && c.name === "li"
      );
      return (
        <View key={key} style={s.list}>
          {items.map((li, i) => {
            const nested = (li.children ?? []).filter(
              (c) => c.type === "tag" && (c.name === "ul" || c.name === "ol")
            );
            const inline = (li.children ?? []).filter(
              (c) => !nested.includes(c)
            );
            return (
              <View key={i}>
                <View style={s.liRow}>
                  <Text style={[s.body, ctx.baseStyle, s.liMarker]}>
                    {ordered ? `${i + 1}.` : "•"}
                  </Text>
                  <Text
                    selectable={ctx.selectable}
                    style={[s.body, ctx.baseStyle, s.li]}
                  >
                    {inline.map((c, j) => renderInline(c, ctx, j))}
                  </Text>
                </View>
                {nested.length ? (
                  <View style={s.nestedList}>{renderBlocks(nested, ctx)}</View>
                ) : null}
              </View>
            );
          })}
        </View>
      );
    }
    case "blockquote":
      return (
        <View key={key} style={s.blockquote}>
          {renderBlocks(el.children ?? [], {
            ...ctx,
            baseStyle: [ctx.baseStyle, s.blockquoteText],
          })}
        </View>
      );
    case "pre":
      return (
        <View key={key} style={s.pre}>
          <Text selectable={ctx.selectable} style={s.codeBlock}>
            {rawText(el).replace(/\n$/, "")}
          </Text>
        </View>
      );
    case "img":
      return (
        <HtmlImg
          key={key}
          src={el.attribs?.src ?? ""}
          contentWidth={ctx.contentWidth}
        />
      );
    case "br":
      return null;
    default:
      // div/section/figure/unknown: render children (forward-compatible).
      return (
        <React.Fragment key={key}>
          {renderBlocks(el.children ?? [], ctx)}
        </React.Fragment>
      );
  }
}

function HtmlImg({ src, contentWidth }: { src: string; contentWidth: number }) {
  const s = useScopedStyles(makeHtmlStyles);
  const [ratio, setRatio] = useState(16 / 9);
  useEffect(() => {
    if (!src) return;
    let alive = true;
    Image.getSize(
      src,
      (w, h) => {
        if (alive && w && h) setRatio(w / h);
      },
      () => {}
    );
    return () => {
      alive = false;
    };
  }, [src]);
  if (!src) return null;
  return (
    <Image
      source={{ uri: src }}
      style={[s.img, { width: Math.max(0, contentWidth), aspectRatio: ratio }]}
      resizeMode="cover"
    />
  );
}

export function HtmlView({
  html,
  contentWidth,
  baseStyle,
  selectable = true,
  onLinkPress,
}: HtmlViewProps) {
  const s = useScopedStyles(makeHtmlStyles);
  const nodes = useMemo(
    () => parseDocument(html || "").children as unknown as DomNode[],
    [html]
  );
  return (
    <View>
      {renderBlocks(nodes, {
        s,
        baseStyle,
        selectable,
        press: onLinkPress ?? openHref,
        contentWidth,
      })}
    </View>
  );
}

// Union of the two former react-native-render-html tagsStyles factories
// (BlogPostScreen + PageRenderer) — values preserved verbatim.
const makeHtmlStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    body: { color: colors.text, fontSize: 16, lineHeight: 24 },
    p: { marginBottom: spacing.md },
    h1: { fontSize: 22, fontWeight: "700", marginBottom: spacing.sm },
    h2: {
      fontSize: 20,
      fontWeight: "700",
      marginTop: spacing.md,
      marginBottom: spacing.sm,
    },
    h3: {
      fontSize: 18,
      fontWeight: "700",
      marginTop: spacing.md,
      marginBottom: spacing.sm,
    },
    h4: {
      fontSize: 16,
      fontWeight: "700",
      marginTop: spacing.md,
      marginBottom: spacing.sm,
    },
    a: { color: colors.primary, textDecorationLine: "underline" },
    strong: { fontWeight: "700" },
    em: { fontStyle: "italic" },
    u: { textDecorationLine: "underline" },
    code: { color: colors.text, fontFamily: "monospace" },
    list: { marginBottom: spacing.md },
    liRow: { flexDirection: "row", marginBottom: spacing.xs },
    liMarker: { width: 22 },
    li: { flex: 1 },
    nestedList: { marginLeft: spacing.md },
    blockquote: {
      borderLeftWidth: 3,
      borderLeftColor: colors.border,
      paddingLeft: spacing.md,
      marginBottom: spacing.md,
    },
    blockquoteText: { color: colors.textMuted },
    pre: {
      backgroundColor: colors.surface,
      padding: spacing.md,
      borderRadius: 8,
      marginBottom: spacing.md,
    },
    codeBlock: {
      color: colors.text,
      fontFamily: "monospace",
      fontSize: 14,
      lineHeight: 20,
    },
    img: {
      borderRadius: 8,
      backgroundColor: colors.surfaceMuted,
      marginBottom: spacing.md,
    },
  });
