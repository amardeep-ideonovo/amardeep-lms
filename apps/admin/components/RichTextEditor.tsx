"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef } from "react";
import { dialog } from "@/components/DialogProvider";

// Split block-level runs of 2+ consecutive <br> into real sibling blocks, so a
// heading + body that were authored (or pasted) as ONE block joined by blank
// lines — e.g. `<h2>Title<br><br>Body</h2>` — become separate, independently
// formattable blocks: `<h2>Title</h2><p>Body</p>`. Without this, a block-level
// command (heading/list/quote) applied anywhere in that block hits the WHOLE
// block, so you can't make just the title a heading and the rest body text.
//
// Rules: only simple text blocks (p / h1–h6) are touched; a heading's FIRST
// segment keeps the heading (it's the title), later segments become paragraphs
// (they're body); a paragraph's segments all stay paragraphs. Single <br> (a
// deliberate soft line break) is preserved. Runs on the client only (DOMParser).
// Idempotent — re-running on its own output is a no-op.
function normalizeBlockBreaks(html: string): string {
  if (!html || typeof window === "undefined") return html;
  const doc = new DOMParser().parseFromString(
    `<body><div id="r">${html}</div></body>`,
    "text/html",
  );
  const root = doc.getElementById("r");
  if (!root) return html;
  const isBr = (n: Node): n is HTMLElement =>
    n.nodeType === 1 && (n as HTMLElement).tagName === "BR";
  const isBlankText = (n: Node) =>
    n.nodeType === 3 && !(n.textContent || "").trim();

  Array.from(root.children).forEach((block) => {
    const tag = block.tagName.toLowerCase();
    if (!/^(?:p|h[1-6])$/.test(tag)) return;
    if (block.querySelectorAll("br").length < 2) return;

    // Walk child nodes, cutting a new segment at each run of 2+ consecutive
    // <br> (blank text nodes between the breaks are ignored). Single <br>s stay
    // inside the current segment as soft breaks.
    const kids = Array.from(block.childNodes);
    const segments: Node[][] = [];
    let cur: Node[] = [];
    for (let i = 0; i < kids.length; i++) {
      if (isBr(kids[i])) {
        let j = i;
        let brs = 0;
        while (j < kids.length && (isBr(kids[j]) || isBlankText(kids[j]))) {
          if (isBr(kids[j])) brs++;
          j++;
        }
        if (brs >= 2) {
          segments.push(cur);
          cur = [];
          i = j - 1;
          continue;
        }
      }
      cur.push(kids[i]);
    }
    segments.push(cur);

    const clean = segments
      .map((seg) => seg.filter((n) => !isBlankText(n)))
      .filter((seg) => seg.length > 0);
    if (clean.length <= 1) return;

    const isHeading = /^h[1-6]$/.test(tag);
    clean.forEach((seg, idx) => {
      const newTag = idx === 0 ? tag : isHeading ? "p" : tag;
      const el = doc.createElement(newTag);
      seg.forEach((n) => el.appendChild(n));
      root.insertBefore(el, block);
    });
    root.removeChild(block);
  });
  return root.innerHTML;
}

// Lightweight TipTap rich-text editor. Emits HTML via onChange; the API
// sanitizes that HTML on write before it is ever stored or shown publicly.
export default function RichTextEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (html: string) => void;
}) {
  // The exact HTML we last emitted upward. Lets the reset effect tell an
  // external content change (open a different record, cancel, restore a draft)
  // — which SHOULD be normalized — apart from the echo of the user's own typing
  // — which must NEVER be reset (that would fight the cursor mid-keystroke).
  const lastEmitted = useRef<string | null>(null);

  const editor = useEditor({
    extensions: [
      // StarterKit (TipTap v3) bundles the Link extension; configure inline.
      StarterKit.configure({
        link: { openOnClick: false, autolink: true },
      }),
    ],
    content: normalizeBlockBreaks(value || "<p></p>"),
    // Required for Next.js: avoid rendering during SSR (hydration mismatch).
    immediatelyRender: false,
    editorProps: { attributes: { class: "tiptap" } },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      lastEmitted.current = html;
      onChange(html);
    },
  });

  // Push EXTERNAL resets (new record, switching to edit, cancel, draft restore)
  // into the editor — normalized — without re-emitting onChange. Skips the
  // editor's own onChange echoes so live typing is never disturbed.
  useEffect(() => {
    if (!editor) return;
    const raw = value || "<p></p>";
    if (raw === lastEmitted.current) return; // our own echo — leave the editor be
    const next = normalizeBlockBreaks(raw);
    if (next !== editor.getHTML()) {
      editor.commands.setContent(next, { emitUpdate: false });
    }
  }, [value, editor]);

  if (!editor) return null;

  const Btn = ({
    label,
    title,
    active,
    onClick,
  }: {
    label: string;
    title?: string;
    active?: boolean;
    onClick: () => void;
  }) => (
    <button
      type="button"
      title={title}
      className={active ? "active" : ""}
      // Keep selection in the editor when clicking a toolbar button.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {label}
    </button>
  );

  // When nothing is selected, expand the selection to the word under the cursor.
  // Without this, clicking Bold/Italic/Link with only a caret placed sets the
  // mark for the NEXT typed characters and leaves the visible text unchanged —
  // which reads as "the button does nothing". Selecting the current word makes
  // it format what the user is looking at, matching every other editor.
  const selectWordIfEmpty = () => {
    const sel = editor.state.selection;
    if (!sel.empty) return;
    const $from = sel.$from;
    const text = $from.parent.textContent;
    const off = $from.parentOffset;
    let s = off;
    let e = off;
    while (s > 0 && /\S/.test(text[s - 1])) s--;
    while (e < text.length && /\S/.test(text[e])) e++;
    if (e > s) {
      const base = $from.start();
      editor.commands.setTextSelection({ from: base + s, to: base + e });
    }
  };

  // Apply a BLOCK type (heading / paragraph) to the SELECTION. A heading is a
  // whole-block node, so normally toggling one converts the entire paragraph —
  // which reads as "it changed all my text, not just what I selected". When the
  // selection is a strict sub-range of one block, split the block around the
  // selection so ONLY the selected text becomes its own heading/paragraph
  // (e.g. select a phrase → Heading → `<p>before</p><h2>phrase</h2><p>after</p>`).
  // For an empty caret or a full-block/multi-block selection there's nothing to
  // isolate, so run the ordinary command in `whole` (which keeps toggle-off).
  const applyBlock = (
    typeName: "heading" | "paragraph",
    attrs: Record<string, unknown>,
    whole: () => void,
  ) => {
    const { $from, $to, from, to, empty } = editor.state.selection;
    const sameBlock = $from.sameParent($to) && $from.parent.isTextblock;
    const strictSubRange =
      !empty && sameBlock && (from > $from.start() || to < $from.end());
    if (!strictSubRange) {
      whole();
      return;
    }
    editor
      .chain()
      .focus()
      .command(({ tr, state, dispatch }) => {
        const type = state.schema.nodes[typeName];
        if (!type) return false;
        const $f = state.selection.$from;
        const bStart = $f.start();
        const bEnd = $f.end();
        const f = state.selection.from;
        const t = state.selection.to;
        if (!dispatch) return true;
        // Split AFTER the selection first (higher position — leaves `f`
        // unaffected), then BEFORE it, isolating the selection in its own block.
        if (t < bEnd) tr.split(t);
        if (f > bStart) tr.split(f);
        const $b = tr.doc.resolve(tr.mapping.map(f));
        tr.setBlockType($b.start(), $b.end(), type, attrs);
        return true;
      })
      .run();
  };

  const setLink = async () => {
    selectWordIfEmpty();
    const prev = (editor.getAttributes("link").href as string) || "https://";
    const url = await dialog.prompt({
      title: "Insert link",
      message: "Link URL",
      defaultValue: prev,
    });
    if (url === null) return;
    if (url.trim() === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: url.trim() })
      .run();
  };

  return (
    <div className="editor">
      <div className="editor-toolbar">
        <Btn
          label="B"
          title="Bold"
          active={editor.isActive("bold")}
          onClick={() => {
            selectWordIfEmpty();
            editor.chain().focus().toggleBold().run();
          }}
        />
        <Btn
          label="I"
          title="Italic"
          active={editor.isActive("italic")}
          onClick={() => {
            selectWordIfEmpty();
            editor.chain().focus().toggleItalic().run();
          }}
        />
        <Btn
          label="H2"
          title="Heading — turns the selected text into a heading"
          active={editor.isActive("heading", { level: 2 })}
          onClick={() =>
            applyBlock("heading", { level: 2 }, () =>
              editor.chain().focus().toggleHeading({ level: 2 }).run(),
            )
          }
        />
        <Btn
          label="H3"
          title="Subheading — turns the selected text into a subheading"
          active={editor.isActive("heading", { level: 3 })}
          onClick={() =>
            applyBlock("heading", { level: 3 }, () =>
              editor.chain().focus().toggleHeading({ level: 3 }).run(),
            )
          }
        />
        <Btn
          label="¶"
          title="Normal text — turns the selected text into a paragraph"
          // Active for a plain paragraph — i.e. neither heading nor list/quote.
          active={editor.isActive("paragraph")}
          onClick={() =>
            applyBlock("paragraph", {}, () =>
              editor.chain().focus().setParagraph().run(),
            )
          }
        />
        <Btn
          label="• List"
          title="Bulleted list"
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
        <Btn
          label="1. List"
          title="Numbered list"
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        />
        <Btn
          label="❝"
          title="Quote"
          active={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        />
        <Btn
          label="Link"
          title="Insert link"
          active={editor.isActive("link")}
          onClick={setLink}
        />
        <Btn
          label="Clear"
          title="Clear formatting"
          onClick={() =>
            editor.chain().focus().unsetAllMarks().clearNodes().run()
          }
        />
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
