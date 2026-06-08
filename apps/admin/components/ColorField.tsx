"use client";

// Native color swatch + a read-only hex readout. Swatch-only guarantees a valid
// #rrggbb (the API validates colors strictly). Shared by the Header + Footer builders.
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
  return (
    <div className="field">
      <label>{label}</label>
      <div className="hb-color">
        <input
          type="color"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="hb-hex">{value}</span>
      </div>
    </div>
  );
}
