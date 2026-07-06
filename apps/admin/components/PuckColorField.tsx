"use client";

// Clearable color input for Puck custom fields (the Design group's color
// props). Unlike ColorField (swatch-only, always a value), design colors are
// OPTIONAL — empty means "theme default" — so this pairs the native picker
// with a free-text input and a clear button. Custom Puck fields own their own
// label rendering, so the label is drawn here.
export default function PuckColorField({
  label,
  value,
  onChange,
}: {
  label?: string;
  value?: string;
  onChange: (v: string) => void;
}) {
  const v = (value || "").trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v : "#3cc4b2";
  return (
    <div style={{ display: "grid", gap: 4 }}>
      {label ? (
        <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-soft)" }}>
          {label}
        </label>
      ) : null}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input
          type="color"
          value={hex}
          onChange={(e) => onChange(e.target.value)}
          title="Pick a color"
          style={{
            width: 34,
            height: 30,
            padding: 0,
            border: "1px solid var(--border-strong)",
            borderRadius: 6,
            background: "none",
            cursor: "pointer",
            flex: "none",
          }}
        />
        <input
          value={v}
          placeholder="Default"
          onChange={(e) => onChange(e.target.value)}
          style={{
            flex: 1,
            minWidth: 0,
            padding: "6px 8px",
            border: "1px solid var(--border-strong)",
            borderRadius: 6,
            fontSize: 13,
            background: "var(--surface-2)",
            color: "var(--text)",
          }}
        />
        {v ? (
          <button
            type="button"
            onClick={() => onChange("")}
            title="Reset to default"
            style={{
              border: "1px solid var(--border-strong)",
              background: "var(--surface-2)",
              borderRadius: 6,
              width: 26,
              height: 26,
              lineHeight: 1,
              cursor: "pointer",
              color: "var(--muted)",
              flex: "none",
            }}
          >
            ×
          </button>
        ) : null}
      </div>
    </div>
  );
}
