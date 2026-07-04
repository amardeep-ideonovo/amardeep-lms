"use client";

import Link from "next/link";
import type { ResolvedMenuItem } from "@lms/types";

// An absolute http(s) URL is external (rendered as <a>); anything else (e.g.
// "/dashboard", "/classes/foo") is an internal route via next/link.
export function isExternal(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

export function MenuLink({
  item,
  className,
  onClick,
}: {
  item: ResolvedMenuItem;
  className?: string;
  onClick?: () => void;
}) {
  const ext = isExternal(item.href);
  const newTab = item.newTab || ext;
  if (ext) {
    return (
      <a
        href={item.href}
        className={className}
        onClick={onClick}
        target={newTab ? "_blank" : undefined}
        rel={newTab ? "noopener noreferrer" : undefined}
      >
        {item.label}
      </a>
    );
  }
  return (
    <Link
      href={item.href}
      className={className}
      onClick={onClick}
      target={item.newTab ? "_blank" : undefined}
    >
      {item.label}
    </Link>
  );
}

// Depth-first flatten with depth, used to render nested items as an indented
// list (dropdowns, mobile drawer, footer columns).
export function flattenChildren(
  items: ResolvedMenuItem[],
  depth = 0,
): { item: ResolvedMenuItem; depth: number }[] {
  const out: { item: ResolvedMenuItem; depth: number }[] = [];
  for (const it of items) {
    out.push({ item: it, depth });
    out.push(...flattenChildren(it.children, depth + 1));
  }
  return out;
}
