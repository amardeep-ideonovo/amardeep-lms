"use client";

// Custom Puck field for the Menu block's `menuId`. The admin picks a menu by
// name from a dropdown instead of pasting an id. Injected into the page + popup
// editors via createPuckConfig({ menuField }); the public site keeps the plain
// text fallback.
import { useEffect, useState } from "react";
import type { MenuListItem } from "@lms/types";
import { api } from "@/lib/api";

let cache: MenuListItem[] | null = null;
let inflight: Promise<MenuListItem[]> | null = null;
function loadMenus(): Promise<MenuListItem[]> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = api
      .listMenus()
      .then((m) => {
        cache = m;
        return m;
      })
      .catch(() => {
        inflight = null;
        return [];
      });
  }
  return inflight;
}

export default function MenuPickerField({
  value,
  onChange,
}: {
  value?: string;
  onChange: (v: string) => void;
}) {
  const [menus, setMenus] = useState<MenuListItem[]>(cache ?? []);

  useEffect(() => {
    let alive = true;
    loadMenus().then((m) => alive && setMenus(m));
    return () => {
      alive = false;
    };
  }, []);

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
          {m.location ? ` (${m.location.toLowerCase()})` : ""}
        </option>
      ))}
      {!known ? <option value={value}>{value} (not found)</option> : null}
    </select>
  );
}
