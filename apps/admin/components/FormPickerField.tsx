"use client";

// Custom Puck field for the Form block's `formId`. Instead of pasting an opaque
// form id, the admin picks a form by name from a dropdown. Injected into the
// page + popup editors via createPuckConfig({ formField }). The public site
// never passes this, so it keeps the plain text fallback there.
import { useEffect, useState } from "react";
import type { FormAdminRow } from "@lms/types";
import { api } from "@/lib/api";

// Module-level cache so multiple Form blocks (and re-renders) share ONE fetch.
let cache: FormAdminRow[] | null = null;
let inflight: Promise<FormAdminRow[]> | null = null;
function loadForms(): Promise<FormAdminRow[]> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = api
      .listForms()
      .then((f) => {
        cache = f;
        return f;
      })
      .catch(() => {
        inflight = null; // allow a later retry
        return [];
      });
  }
  return inflight;
}

export default function FormPickerField({
  value,
  onChange,
}: {
  value?: string;
  onChange: (v: string) => void;
}) {
  const [forms, setForms] = useState<FormAdminRow[]>(cache ?? []);

  useEffect(() => {
    let alive = true;
    loadForms().then((f) => alive && setForms(f));
    return () => {
      alive = false;
    };
  }, []);

  // Keep a saved id selectable even if it's missing from the list (deleted form).
  const known = !value || forms.some((f) => f.id === value);

  return (
    <select
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%",
        padding: "8px 10px",
        borderRadius: 6,
        border: "1px solid var(--border)",
        font: "inherit",
        background: "var(--surface-2)",
      }}
    >
      <option value="">— Select a form —</option>
      {forms.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name}
          {f.status !== "ACTIVE" ? " (inactive)" : ""}
        </option>
      ))}
      {!known ? <option value={value}>{value} (not found)</option> : null}
    </select>
  );
}
