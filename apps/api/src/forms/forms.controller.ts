import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { once } from "node:events";
import type { Request, Response } from "express";
import { Throttle } from "@nestjs/throttler";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { RequirePermission } from "../auth/require-permission.decorator";
import { FormsService } from "./forms.service";
import {
  CreateFormDto,
  FormSubmitDto,
  ListFormSubmissionsQueryDto,
  UpdateFormDto,
} from "./dto/form.dto";

// Form routes. The /forms/* reads + submit are PUBLIC (no guard) and only ACTIVE
// forms are exposed. All management + the in-house audience lookups live under
// /admin/* behind the `forms` permission.
@Controller()
export class FormsController {
  constructor(private readonly forms: FormsService) {}

  // ----- Public (no auth) -----

  @Get("forms/:id")
  getPublic(@Param("id") id: string) {
    return this.forms.getPublic(id);
  }

  // Per-IP rate limit: unauthenticated write that persists a FormSubmission
  // row per call — cap submission spam / DB-row growth.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post("forms/:id/submit")
  submit(@Param("id") id: string, @Body() dto: FormSubmitDto) {
    return this.forms.submit(id, dto.values);
  }

  // Paste-anywhere embed widget: <script src="…/forms/:id/embed.js"></script>.
  @Get("forms/:id/embed.js")
  embedScript(
    @Param("id") id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const base =
      process.env.PUBLIC_API_URL?.replace(/\/$/, "") ||
      `${req.protocol}://${req.get("host")}`;
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.send(this.forms.buildEmbedScript(id, base));
  }

  // The form editor's audience picker + field mapper read OUR in-house list via
  // the canonical contacts endpoints (GET /admin/audiences and
  // /admin/audiences/:id/fields on ContactsController), so this controller no
  // longer exposes any audience lookups of its own.

  // ----- Admin: form CRUD -----

  @UseGuards(PermissionsGuard)
  @RequirePermission("forms", "read")
  @Get("admin/forms")
  adminList() {
    return this.forms.adminList();
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission("forms", "read")
  @Get("admin/forms/:id")
  adminGet(@Param("id") id: string) {
    return this.forms.adminGet(id);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission("forms", "read")
  // Bare FormSubmissionDTO[] (NOT an envelope — the BDD suite asserts
  // Array.isArray on this body). Paging is opt-in: ?limit + ?cursor, where the
  // cursor is the id of the last row the caller holds. A full page means there
  // may be more; for the COMPLETE set use the .csv route below.
  @Get("admin/forms/:id/submissions")
  adminListSubmissions(
    @Param("id") id: string,
    @Query() query: ListFormSubmissionsQueryDto,
  ) {
    return this.forms.listSubmissions(id, query);
  }

  // Full CSV export, streamed. Independent of whatever the viewer has paged in,
  // which is what stops the export from silently losing rows.
  @UseGuards(PermissionsGuard)
  @RequirePermission("forms", "read")
  @Get("admin/forms/:id/submissions.csv")
  async adminExportSubmissionsCsv(
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    const rows = this.forms.csvRows(id);
    // Pull the first chunk BEFORE touching the response: a missing form throws
    // here and Nest can still render a clean 404 JSON body.
    const first = await rows.next();

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    // Static filename — the admin client renames on save (see downloadBlob), so
    // a client-supplied form name never reaches a response header.
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="submissions.csv"',
    );
    res.setHeader("Cache-Control", "no-store");

    // Honour backpressure so a large export can't balloon in memory.
    const write = async (chunk: string): Promise<void> => {
      if (!res.write(chunk)) await once(res, "drain");
    };

    try {
      if (!first.done) await write(first.value);
      for await (const line of rows) await write(line);
      res.end();
    } catch (err) {
      // Headers (and a 200) are already committed, so we cannot turn this into
      // an error status. Destroy the socket instead: a truncated download must
      // fail loudly rather than save as a well-formed but incomplete file.
      res.destroy(err instanceof Error ? err : new Error("CSV export failed"));
    }
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission("forms", "create")
  @Post("admin/forms")
  adminCreate(@Body() dto: CreateFormDto) {
    return this.forms.adminCreate(dto);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission("forms", "edit")
  @Patch("admin/forms/:id")
  adminUpdate(@Param("id") id: string, @Body() dto: UpdateFormDto) {
    return this.forms.adminUpdate(id, dto);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission("forms", "delete")
  @Delete("admin/forms/:id")
  adminDelete(@Param("id") id: string) {
    return this.forms.adminDelete(id);
  }
}
