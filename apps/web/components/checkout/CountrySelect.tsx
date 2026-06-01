"use client";

import { getCountries } from "@/lib/countries";

// Native country dropdown (full ISO list). The native <select> is type-to-search
// on every platform, which satisfies the "searchable if easy" requirement.
export default function CountrySelect({
  id = "country",
  value,
  onChange,
  disabled,
}: {
  id?: string;
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
}) {
  const countries = getCountries();
  return (
    <div className="co-field co-field--select">
      <label className="co-float-label" htmlFor={id}>
        Country or region
      </label>
      <select
        id={id}
        className="co-select-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        {countries.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}
