"use client";

// Custom Puck field for the Menu block's `menuId`. The admin picks a menu by
// name from a dropdown instead of pasting an id. Injected into the page + popup
// editors via createPuckConfig({ menuField }); the public site keeps the plain
// text fallback.
import { useMenusList } from "@/lib/queries";

export default function MenuPickerField({
  value,
  onChange,
}: {
  value?: string;
  onChange: (v: string) => void;
}) {
  // Shared query cache: multiple Menu blocks (and re-renders) share ONE fetch.
  // Best-effort — while loading or on a load error the dropdown renders empty.
  const { data } = useMenusList();
  const menus = data ?? [];

  const known = !value || menus.some((m) => m.id === value);

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
      <option value="">— Select a menu —</option>
      {menus.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
          {m.locations.length
            ? ` (${m.locations.map((l) => l.toLowerCase()).join("/")})`
            : ""}
        </option>
      ))}
      {!known ? <option value={value}>{value} (not found)</option> : null}
    </select>
  );
}
