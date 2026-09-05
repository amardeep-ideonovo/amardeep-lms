import Link from "next/link";
import { buttonClass } from "@lms/ui";
import { STR } from "@lms/types";

// Branded 404 for unmatched routes and notFound() calls. Renders inside the root
// layout (Nav + Footer + .container), so it only fills the content slot. Server
// component — no client JS needed.
export default function NotFound() {
  return (
    <div className="error-state">
      <div className="error-state__badge" aria-hidden="true">
        404
      </div>
      <h1 className="error-state__title">{STR.errors.notFoundTitle}</h1>
      <p className="error-state__body">{STR.errors.notFoundBody}</p>
      <div className="error-state__actions">
        <Link href="/" className={buttonClass()}>
          {STR.errors.backHome}
        </Link>
      </div>
    </div>
  );
}
