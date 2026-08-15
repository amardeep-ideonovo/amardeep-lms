// The one ApiError every client throws (docs/coding-standards.md D5).
// Until 2026-08 this class was declared three times (web/lib/api.ts,
// admin/lib/api.ts, mobile/src/api.ts) with identical shape; those files now
// re-export this one, so `instanceof ApiError` means the same thing everywhere
// and error-shape changes happen in exactly one place.
//
// Server note: apps/api never imports this at runtime (it throws Nest
// HttpExceptions); it lives here because packages/types is the only package
// all three clients already consume — including mobile, which cannot resolve
// "@lms/ui" (a DOM-flavored package) through Metro without ceremony.

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}
