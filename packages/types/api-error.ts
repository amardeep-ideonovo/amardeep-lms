// The one ApiError every client throws (docs/coding-standards.md D5/D6).
// Until 2026-08 this class was declared three times (web/lib/api.ts,
// admin/lib/api.ts, mobile/src/api.ts) with identical shape; those files now
// re-export this one, so `instanceof ApiError` means the same thing everywhere
// and error-shape changes happen in exactly one place.
//
// `code` (D6) is the machine-readable branch point: the API's
// HttpExceptionFilter stamps every error body with one, the shared request
// cores parse it, and "UNSPECIFIED" is the well-formed default for legacy
// string-only throws — so client code can always branch on `code` without
// probing for its presence.
//
// Server note: apps/api never imports this at runtime (it throws Nest
// HttpExceptions); it lives here because packages/types is the only package
// all three clients already consume — including mobile, which cannot resolve
// "@lms/ui" (a DOM-flavored package) through Metro without ceremony.

import type { ErrorCode } from "./error-codes";

export class ApiError extends Error {
  status: number;
  code: ErrorCode;
  constructor(
    status: number,
    message: string,
    code: ErrorCode = "UNSPECIFIED",
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "ApiError";
  }
}
