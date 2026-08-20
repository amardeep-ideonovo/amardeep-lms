"use client";

import { useState } from "react";
import {
  type ColorFormat,
  formatColor,
  parseColor,
  toSwatchHex,
} from "@/lib/color";

// Native color swatch + a format picker (HEX / RGB / HSL) and an editable text
// field. The swatch guarantees a valid #rrggbb; the text field lets the admin
// read or type a color in whichever notation they prefer. Whatever the display
// format, onChange ALWAYS receives a strict #rrggbb (the API validates colors
// strictly). Shared by the Header, Footer, Certificate + App-Customization
// builders.
export default function ColorField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const [fmt, setFmt] = useState<ColorFormat>("hex");
  // While the admin is typing we keep their raw text (which may be a half-typed,
  // not-yet-valid color) instead of snapping it back to the canonical value.
  const [draft, setDraft] = useState<string | null>(null);

  const hex = toSwatchHex(value);
  const shown = draft ?? formatColor(hex, fmt);

  return (
    <div className="field">
      <label>{label}</label>
      <div className="hb-color">
        <input
          type="color"
          value={hex}
          disabled={disabled}
          aria-label={`${label} — pick a color`}
          onChange={(e) => {
            setDraft(null);
            onChange(e.target.value);
          }}
        />
        <select
          className="hb-fmt"
          aria-label={`${label} color format`}
          value={fmt}
          disabled={disabled}
          onChange={(e) => {
            setDraft(null); // reformat the current value into the new notation
            setFmt(e.target.value as ColorFormat);
          }}
        >
          <option value="hex">HEX</option>
          <option value="rgb">RGB</option>
          <option value="hsl">HSL</option>
        </select>
        <input
          className="hb-color-text"
          type="text"
          value={shown}
          disabled={disabled}
          spellCheck={false}
          aria-label={`${label} color value`}
          onChange={(e) => {
            const next = e.target.value;
            setDraft(next);
            const parsed = parseColor(next);
            if (parsed) onChange(parsed); // only ever emit strict #rrggbb
          }}
          // Snap the field back to the canonical formatted value on blur, so an
          // invalid/partial draft never lingers.
          onBlur={() => setDraft(null)}
        />
      </div>
    </div>
  );
}
