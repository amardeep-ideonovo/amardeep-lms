import { redirect } from "next/navigation";

export default function HomePage() {
  // Default landing -> levels. AuthGuard handles the login redirect.
  redirect("/levels");
}
