"use client";

import { useEffect, useState } from "react";
import type { ResolvedMenu } from "@lms/types";
import { api } from "@/lib/api";
import { MenuLink, flattenChildren } from "./MenuLink";

// Renders a menu embedded in a CMS page (the Puck "Menu" block). Resolves the
// menu by id with the same server-side visibility filtering as the header.
export default function PageMenu({ menuId }: { menuId: string }) {
  const [menu, setMenu] = useState<ResolvedMenu | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .resolveMenuById(menuId)
      .then((m) => alive && setMenu(m))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [menuId]);

  if (!menu || menu.items.length === 0) return null;

  return (
    <nav className="lmspb-container lmspb-w-normal page-menu">
      {flattenChildren(menu.items).map(({ item, depth }) => (
        <div key={item.id} style={{ paddingLeft: depth * 16 }}>
          <MenuLink item={item} className="page-menu-link" />
        </div>
      ))}
    </nav>
  );
}
