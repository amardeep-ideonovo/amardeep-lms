import { redirect } from "next/navigation";

// "Levels" was renamed to "Classes". Keep the old URL working for any saved
// bookmarks by redirecting to the new route.
export default function LevelsRedirect() {
  redirect("/classes");
}
