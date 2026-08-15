import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from "@nestjs/common";
import type { Response } from "express";

// D6 (docs/coding-standards.md): every HTTP error body carries a
// machine-readable `code` so clients branch on codes instead of parsing
// English prose. Converted throws pass `{ code, message }` to their
// exception; everything legacy (a bare string message) is normalized to
// `code: "UNSPECIFIED"` here — one response shape, no per-throw migration
// deadline. The filter is deliberately ADDITIVE: it reproduces Nest's default
// body fields (statusCode, message, error) exactly and only adds `code`, so
// nothing that parses today's shape breaks (clients read `message`; BDD
// asserts on status codes).
//
// This is the repo's only custom exception filter on purpose — the audit
// found zero, and the standard keeps error semantics in services, not in
// filter logic. Sentry's global filter still sees exceptions first in the
// chain (registered via SentryModule); this one only shapes HttpException
// responses.
@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const status = exception.getStatus();
    const payload = exception.getResponse();

    let body: Record<string, unknown>;
    if (typeof payload === "string") {
      // Nest's default for `new XException("msg")`.
      body = { statusCode: status, message: payload, error: exception.name };
    } else {
      body = { statusCode: status, ...(payload as Record<string, unknown>) };
    }
    if (typeof body.code !== "string" || body.code === "") {
      body.code = "UNSPECIFIED";
    }
    res.status(status).json(body);
  }
}
