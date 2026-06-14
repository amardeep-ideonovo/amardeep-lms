"use client";

import { useEffect, useState, type FormEvent } from "react";
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

  if (loading) return <div className="form-embed-note">Loading…</div>;
  if (missing || !def) return null; // embeds render nothing if the form is gone
  if (done) return <div className="form-embed-success">{done}</div>;

  return (
    <form onSubmit={onSubmit} className="form-embed" noValidate>
      {def.fields.map((f) => (
        <div key={f.id} className="form-embed-field">
          {f.type !== "checkbox" && (
            <label className="form-embed-label">
              {f.label}
              {f.required ? " *" : ""}
            </label>
          )}
          {renderInput(f, values[f.name], setVal)}
        </div>
      ))}
      {submitError && <div className="form-embed-error">{submitError}</div>}
      <button
        type="submit"
        disabled={submitting}
        className="form-embed-submit"
      >
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
        className="form-embed-input form-embed-textarea"
        value={String(value ?? "")}
        placeholder={f.placeholder}
        required={f.required}
        onChange={(e) => setVal(f.name, e.target.value)}
      />
    );
  }
  if (f.type === "checkbox") {
    return (
      <label className="form-embed-checkbox">
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
        className="form-embed-input form-embed-select"
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
      className="form-embed-input"
      type={inputType}
      value={String(value ?? "")}
      placeholder={f.placeholder}
      required={f.required}
      onChange={(e) => setVal(f.name, e.target.value)}
    />
  );
}

