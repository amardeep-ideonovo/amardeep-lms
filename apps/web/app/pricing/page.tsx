import { redirect } from "next/navigation";

// Billing (current plan + payment history) now lives under /account; the full
// plan catalog is at /pricing/all. The old /pricing summary is retired, so this
// route just forwards to the billing hub.
export default function PricingPage() {
  redirect("/account");
}
