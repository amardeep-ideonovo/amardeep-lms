"use client";

import {
  useEffect,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import type { FormFieldDef, FormPublicDTO } from "@lms/types";
import { ApiError, fetchPublicForm, submitForm } from "@/lib/api";

// Interactive, embeddable Mailchimp-linked form. Drop <FormEmbed formId="…" />
// into any page, popup, or screen. Fetches its definition client-side, validates,
// submits to the public API (which stores the entry + subscribes to Mailchimp),
// then shows the success message or redirects.
export default function FormEmbed({ formId }: { formId: string }) {
  const [def, setDef] = useState<FormPublicDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const f = await fetchPublicForm(formId);
        if (!alive) return;
        if (!f) {
          setMissing(true);
          return;
        }
        setDef(f);
        const init: Record<string, string | boolean> = {};
        for (const fld of f.fields) {
          init[fld.name] = fld.type === "checkbox" ? false : "";
        }
        setValues(init);
      } catch {
        if (alive) setMissing(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [formId]);

  const setVal = (name: string, v: string | boolean) =>
    setValues((s) => ({ ...s, [name]: v }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!def) return;
    for (const f of def.fields) {
      const v = values[f.name];
      const empty =
        v === undefined || v === "" || (f.type === "checkbox" && v !== true);
      if (f.required && empty) {
        setSubmitError(`"${f.label}" is required`);
        return;
      }
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await submitForm(formId, values);
      if (res.redirectUrl) {
        window.location.href = res.redirectUrl;
        return;
      }
      setDone(res.message || "Thanks! You're subscribed.");
    } catch (err) {
      setSubmitError(
        err instanceof ApiError
          ? err.message
          : "Something went wrong. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div style={styles.note}>Loading…</div>;
  if (missing || !def) return null; // embeds render nothing if the form is gone
  if (done) return <div style={styles.success}>{done}</div>;

  return (
    <form onSubmit={onSubmit} style={styles.form} noValidate>
      {def.fields.map((f) => (
        <div key={f.id} style={styles.field}>
          {f.type !== "checkbox" && (
            <label style={styles.label}>
              {f.label}
              {f.required ? " *" : ""}
            </label>
          )}
          {renderInput(f, values[f.name], setVal)}
        </div>
      ))}
      {submitError && <div style={styles.error}>{submitError}</div>}
      <button type="submit" disabled={submitting} style={styles.button}>
        {submitting ? "Submitting…" : "Submit"}
      </button>
    </form>
  );
}

function renderInput(
  f: FormFieldDef,
  value: string | boolean | undefined,
  setVal: (name: string, v: string | boolean) => void
) {
  if (f.type === "textarea") {
    return (
      <textarea
        style={{ ...styles.input, minHeight: 90 }}
        value={String(value ?? "")}
        placeholder={f.placeholder}
        required={f.required}
        onChange={(e) => setVal(f.name, e.target.value)}
      />
    );
  }
  if (f.type === "checkbox") {
    return (
      <label style={styles.checkboxRow}>
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => setVal(f.name, e.target.checked)}
        />
        {f.label}
        {f.required ? " *" : ""}
      </label>
    );
  }
  if (f.type === "select") {
    return (
      <select
        style={styles.input}
        value={String(value ?? "")}
        required={f.required}
        onChange={(e) => setVal(f.name, e.target.value)}
      >
        <option value="">{f.placeholder || "Select…"}</option>
        {(f.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  const inputType =
    f.type === "email"
      ? "email"
      : f.type === "phone"
      ? "tel"
      : f.type === "number"
      ? "number"
      : "text";
  return (
    <input
      style={styles.input}
      type={inputType}
      value={String(value ?? "")}
      placeholder={f.placeholder}
      required={f.required}
      onChange={(e) => setVal(f.name, e.target.value)}
    />
  );
}

const styles: Record<string, CSSProperties> = {
  form: { display: "flex", flexDirection: "column", gap: 14, maxWidth: 480 },
  field: { display: "flex", flexDirection: "column", gap: 6 },
  label: { fontWeight: 600, fontSize: 14 },
  input: {
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid #d1d5db",
    font: "inherit",
    width: "100%",
  },
  checkboxRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 14 },
  button: {
    padding: "12px 22px",
    borderRadius: 999,
    border: "none",
    background: "#6d28d9",
    color: "#fff",
    fontWeight: 600,
    cursor: "pointer",
    alignSelf: "flex-start",
  },
  error: { color: "#dc2626", fontSize: 14 },
  success: {
    padding: 16,
    borderRadius: 10,
    background: "#dcfce7",
    color: "#166534",
  },
  note: { color: "#6b7280" },
};
