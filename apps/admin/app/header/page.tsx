"use client";

import { useEffect, useState } from "react";
import type {
  CourseCard,
  LevelDTO,
  MenuListItem,
  PageListItem,
  PostAdminRow,
} from "@lms/types";
import { ApiError, api } from "@/lib/api";
import { useAdminAuth } from "@/components/AdminAuthProvider";
import HeaderBuilder from "./HeaderBuilder";

// Standalone "Header" page (sidebar item above Navigation). Builds site headers
// and their placement rules. Gated by the `menus` permission, same as menus.
export default function HeaderPage() {
  const { can, loading: authLoading } = useAdminAuth();

  const [menus, setMenus] = useState<MenuListItem[]>([]);
  const [pages, setPages] = useState<PageListItem[]>([]);
  const [levels, setLevels] = useState<LevelDTO[]>([]);
  const [courses, setCourses] = useState<CourseCard[]>([]);
  const [posts, setPosts] = useState<PostAdminRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !can("menus", "read")) return;
    Promise.all([
      api.listMenus(),
      api.listPages().catch(() => [] as PageListItem[]),
      api.listLevels().catch(() => [] as LevelDTO[]),
      api.listCourses().catch(() => [] as CourseCard[]),
      api.listPosts().catch(() => [] as PostAdminRow[]),
    ])
      .then(([m, pg, lv, cs, ps]) => {
        setMenus(m);
        setPages(pg);
        setLevels(lv);
        setCourses(cs);
        setPosts(ps);
      })
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "Failed to load."),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading]);

  if (authLoading) return <p className="muted">Loading…</p>;
  if (!can("menus", "read"))
    return (
      <div>
        <div className="page-header">
          <h1>Header</h1>
        </div>
        <p className="muted">You don’t have permission to view this.</p>
      </div>
    );

  return (
    <div>
      <div className="page-header">
        <h1>Header</h1>
        <p className="subtitle">
          Build site headers and choose where each appears — by page and by who’s
          visiting. The first matching header (top of the list) is shown; if none
          match, the built-in default is used.
        </p>
      </div>
      {error && <p className="error">{error}</p>}
      <HeaderBuilder
        menus={menus}
        pages={pages}
        levels={levels}
        courses={courses}
        posts={posts}
        canEdit={can("menus", "edit")}
        canCreate={can("menus", "create")}
        canDelete={can("menus", "delete")}
        onError={setError}
      />
    </div>
  );
}
