"use client";

// Puck editor chrome + shared block styles. Imported here (route-scoped) so the
// heavy editor CSS only loads on this full-screen page.
import "@puckeditor/core/puck.css";
import "@lms/puck/styles.css";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Puck } from "@puckeditor/core";
import type { Data, Field } from "@puckeditor/core";
import { createPuckConfig } from "@lms/puck";
import type { PageProps, RootProps } from "@lms/puck";
import type { PageStatus, PuckDocument } from "@lms/types";
import { ApiError, api } from "@/lib/api";
import RichTextEditor from "@/components/RichTextEditor";
import FormPickerField from "@/components/FormPickerField";
import MediaPicker from "@/components/MediaPicker";

type PageData = Data<PageProps, RootProps>;
type SaveState = "idle" | "saving" | "saved" | "error";

const WEB_URL =
  process.env.NEXT_PUBLIC_WEB_URL?.replace(/\/$/, "") || "http://localhost:3002";

// Editor-side preview for the Puck "Form" block (the real form renders on the site).
function FormPreview({ formId }: { formId: string }) {
  return (
    <div
      style={{
        border: "1px dashed #cbd5e1",
        borderRadius: 8,
        padding: 16,
        color: "#64748b",
        textAlign: "center",
      }}
    >
      {formId ? `Embedded form: ${formId}` : "Form block — set a Form ID in the panel"}
    </div>
  );
}

export default function PageEditor() {
  const params = useParams();
  const id = String((params?.id as string) ?? "");
  const router = useRouter();

  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [initialData, setInitialData] = useState<PageData | null>(null);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [status, setStatus] = useState<PageStatus>("DRAFT");
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const latest = useRef<PageData | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // RichText field reuses the existing TipTap editor. It's injected here (admin
  // only) so TipTap never ships in the public <Render> bundle.
  const config = useMemo(() => {
    const richTextField = {
      type: "custom" as const,
      render: ({
        value,
        onChange,
      }: {
        value?: string;
        onChange: (v: string) => void;
      }) => <RichTextEditor value={value || ""} onChange={onChange} />,
    } as Field;
    const formField = {
      type: "custom" as const,
      label: "Form",
      render: ({
        value,
        onChange,
      }: {
        value?: string;
        onChange: (v: string) => void;
      }) => <FormPickerField value={value} onChange={onChange} />,
    } as Field;
    const imageField = {
      type: "custom" as const,
      render: ({
        value,
        onChange,
      }: {
        value?: string;
        onChange: (v: string) => void;
      }) => <MediaPicker value={value || ""} onChange={onChange} />,
    } as Field;
    return createPuckConfig({
      richTextField,
      formComponent: FormPreview,
      formField,
      imageField,
    });
  }, []);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    (async () => {
      try {
        const page = await api.getPage(id);
        if (!alive) return;
        setTitle(page.title);
        setSlug(page.slug);
        setStatus(page.status);
        const data = page.data as unknown as PageData;
        latest.current = data;
        setInitialData(data);
      } catch (err) {
        if (alive)
          setLoadError(
            err instanceof ApiError ? err.message : "Failed to load page"
          );
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [id]);

  function persist(extra?: { status?: PageStatus }) {
    return api.updatePage(id, {
      data: (latest.current ?? undefined) as unknown as PuckDocument | undefined,
      ...extra,
    });
  }

  // Debounced autosave of the draft document on every edit.
  function scheduleSave(data: PageData) {
    latest.current = data;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState("saving");
    saveTimer.current = setTimeout(async () => {
      try {
        await persist();
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 1000);
  }

  async function saveStatus(next: PageStatus) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState("saving");
    try {
      const updated = await persist({ status: next });
      setStatus(updated.status);
      setSaveState("saved");
    } catch (err) {
      setSaveState("error");
      alert(err instanceof ApiError ? err.message : "Failed to update status");
    }
  }

  async function saveTitleSlug() {
    try {
      const updated = await api.updatePage(id, {
        title: title.trim() || "Untitled page",
        slug: slug.trim() || undefined,
      });
      setTitle(updated.title);
      setSlug(updated.slug);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to save title/slug");
    }
  }

  if (!loaded) {
    return (
      <div style={{ padding: 40 }} className="muted">
        Loading editor…
      </div>
    );
  }
  if (loadError) {
    return (
      <div style={{ padding: 40 }}>
        <p className="error">{loadError}</p>
        <button className="btn" onClick={() => router.push("/pages")}>
          ← Back to Pages
        </button>
      </div>
    );
  }
  if (!initialData) return null;

  const saveLabel =
    saveState === "saving"
      ? "Saving…"
      : saveState === "saved"
      ? "Saved ✓"
      : saveState === "error"
      ? "Save failed"
      : "";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        background: "#fff",
        zIndex: 1000,
      }}
    >
      {/* Our toolbar: navigation + title/slug + status. Puck's own header below
          provides the viewport switcher and the Publish button. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 14px",
          borderBottom: "1px solid #e2e5ea",
          flex: "none",
        }}
      >
        <button
          className="btn btn--ghost btn--sm"
          onClick={() => router.push("/pages")}
        >
          ← Pages
        </button>
        <input
          aria-label="Page title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitleSlug}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          placeholder="Page title"
          style={{ fontWeight: 600, minWidth: 220 }}
        />
        <span
          className="muted"
          style={{ display: "inline-flex", alignItems: "center", gap: 2 }}
        >
          /
          <input
            aria-label="Slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            onBlur={saveTitleSlug}
            style={{ width: 150 }}
          />
        </span>
        <span
          className={
            status === "PUBLISHED"
              ? "badge badge--published"
              : "badge badge--draft"
          }
        >
          {status === "PUBLISHED" ? "Published" : "Draft"}
        </span>
        <span
          className="muted"
          style={{ marginLeft: "auto", minWidth: 72, textAlign: "right" }}
        >
          {saveLabel}
        </span>
        {status === "PUBLISHED" && (
          <>
            <a
              className="btn btn--ghost btn--sm"
              href={`${WEB_URL}/${slug}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              View
            </a>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => saveStatus("DRAFT")}
            >
              Unpublish
            </button>
          </>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        <Puck
          config={config}
          data={initialData}
          onChange={(data) => scheduleSave(data)}
          onPublish={(data) => {
            latest.current = data;
            saveStatus("PUBLISHED");
          }}
        />
      </div>
    </div>
  );
}
