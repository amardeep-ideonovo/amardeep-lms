"use client";

import type {
  CourseCard,
  HeaderCtaLink,
  LevelDTO,
  MenuItemType,
  PageListItem,
  PostAdminRow,
} from "@lms/types";

// Controlled link/target picker — the same target options as the menu "Add item"
// picker, so a CTA resolves to the identical href a menu item would. Reused for
// each header CTA. The *_INDEX types and CUSTOM resolve to fixed/free URLs.
const TYPES: { value: MenuItemType; label: string }[] = [
  { value: "CUSTOM", label: "Custom link" },
  { value: "PAGE", label: "CMS Page" },
  { value: "CLASS", label: "Class" },
  { value: "CLASS_INDEX", label: "Classes index" },
  { value: "COURSE", label: "Course" },
  { value: "COURSE_INDEX", label: "Courses index" },
  { value: "BLOG_INDEX", label: "Blog index" },
  { value: "BLOG_POST", label: "Blog post" },
];

const FIXED: Partial<Record<MenuItemType, string>> = {
  CLASS_INDEX: "/pricing/all",
  COURSE_INDEX: "/dashboard",
  BLOG_INDEX: "/blog",
};

export function CtaTargetPicker({
  value,
  onChange,
  pages,
  levels,
  courses,
  posts,
  disabled,
}: {
  value: HeaderCtaLink;
  onChange: (link: HeaderCtaLink) => void;
  pages: PageListItem[];
  levels: LevelDTO[];
  courses: CourseCard[];
  posts: PostAdminRow[];
  disabled?: boolean;
}) {
  // Switching type clears the other target ids (keep openNewTab).
  const setType = (type: MenuItemType) =>
    onChange({
      type,
      url: null,
      pageId: null,
      levelId: null,
      courseId: null,
      postId: null,
      openNewTab: value.openNewTab,
    });
  const set = (patch: Partial<HeaderCtaLink>) => onChange({ ...value, ...patch });
  const fixed = FIXED[value.type];

  return (
    <div className="form-row">
      <div className="field">
        <label>Links to</label>
        <select
          value={value.type}
          disabled={disabled}
          onChange={(e) => setType(e.target.value as MenuItemType)}
        >
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field" style={{ flex: 2 }}>
        <label>Target</label>
        {value.type === "CUSTOM" && (
          <input
            value={value.url ?? ""}
            disabled={disabled}
            placeholder="https://example.com or /pricing"
            onChange={(e) => set({ url: e.target.value })}
          />
        )}
        {value.type === "PAGE" && (
          <select
            value={value.pageId ?? ""}
            disabled={disabled}
            onChange={(e) => set({ pageId: e.target.value })}
          >
            <option value="">— Select a page —</option>
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        )}
        {value.type === "CLASS" && (
          <select
            value={value.levelId ?? ""}
            disabled={disabled}
            onChange={(e) => set({ levelId: e.target.value })}
          >
            <option value="">— Select a class —</option>
            {levels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
        {value.type === "COURSE" && (
          <select
            value={value.courseId ?? ""}
            disabled={disabled}
            onChange={(e) => set({ courseId: e.target.value })}
          >
            <option value="">— Select a course —</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        )}
        {value.type === "BLOG_POST" && (
          <select
            value={value.postId ?? ""}
            disabled={disabled}
            onChange={(e) => set({ postId: e.target.value })}
          >
            <option value="">— Select a post —</option>
            {posts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        )}
        {fixed && <input value={fixed} disabled />}
      </div>
    </div>
  );
}
