"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect } from "react";
import { dialog } from "@/components/DialogProvider";

// Lightweight TipTap rich-text editor. Emits HTML via onChange; the API
// sanitizes that HTML on write before it is ever stored or shown publicly.
export default function RichTextEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (html: string) => void;
}) {
  const editor = useEditor({
    extensions: [
      // StarterKit (TipTap v3) bundles the Link extension; configure inline.
      StarterKit.configure({
        link: { openOnClick: false, autolink: true },
      }),
    ],
    content: value || "<p></p>",
    // Required for Next.js: avoid rendering during SSR (hydration mismatch).
    immediatelyRender: false,
    editorProps: { attributes: { class: "tiptap" } },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  // Push external resets (new post, switching to edit, cancel) into the editor
  // without re-emitting onChange.
  useEffect(() => {
    if (!editor) return;
    const next = value || "<p></p>";
    if (next !== editor.getHTML()) {
      editor.commands.setContent(next, { emitUpdate: false });
    }
     
  }, [value, editor]);

  if (!editor) return null;

  const Btn = ({
    label,
    active,
    onClick,
  }: {
    label: string;
    active?: boolean;
    onClick: () => void;
  }) => (
    <button
      type="button"
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
        <Btn label="B" active={editor.isActive("bold")} onClick={() => { selectWordIfEmpty(); editor.chain().focus().toggleBold().run(); }} />
        <Btn label="I" active={editor.isActive("italic")} onClick={() => { selectWordIfEmpty(); editor.chain().focus().toggleItalic().run(); }} />
        <Btn label="H2" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
        <Btn label="H3" active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />
        <Btn label="• List" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} />
        <Btn label="1. List" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
        <Btn label="❝" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} />
        <Btn label="Link" active={editor.isActive("link")} onClick={setLink} />
        <Btn label="Clear" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} />
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
