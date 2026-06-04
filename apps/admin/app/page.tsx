import { redirect } from "next/navigation";

export default function HomePage() {
  // Default landing -> classes. AuthGuard handles the login redirect.
  redirect("/classes");
}
