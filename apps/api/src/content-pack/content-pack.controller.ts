import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { ServiceTokenGuard } from "../auth/guards/service-token.guard";
import { ContentPackService } from "./content-pack.service";
import type { ImportResult, PackStatus } from "./content-pack.types";

// Control-plane -> instance channel for the "demo content pack" feature. Same
// per-instance service token as /instance-admin and /support (ServiceTokenGuard),
// NOT a user JWT: the caller is the operator console, publishing the demo
// instance's content and replaying it into freshly provisioned instances.
//
// The archive is a gzipped JSON document. Export streams it as the response
// body; import receives it as the raw request body — main.ts registers an
// express.raw parser scoped to POST /content-pack/import (the same pattern the
// Stripe/PayPal webhooks use), so req.body is the raw Buffer regardless of the
// Content-Type the caller sends.

@UseGuards(ServiceTokenGuard)
@Controller("content-pack")
export class ContentPackController {
  constructor(private readonly svc: ContentPackService) {}

  // What pack (if any) this instance has imported — lets the control plane show
  // staleness and avoid a redundant push.
  @Get("status")
  status(): Promise<PackStatus> {
    return this.svc.status();
  }

  // Snapshot this instance's authored content into a portable pack.
  @Get("export")
  async export(@Res() res: Response): Promise<void> {
    const buf = await this.svc.export();
    res.setHeader("Content-Type", "application/gzip");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="content-pack.json.gz"',
    );
    res.setHeader("Content-Length", String(buf.length));
    res.end(buf);
  }

  // Seed this (empty) instance from a pack. Idempotent: a second push is a no-op.
  // `version`/`label` are the control-plane DemoPack identity, recorded for
  // provenance and staleness checks.
  @Post("import")
  @HttpCode(200)
  async import(
    @Req() req: Request,
    @Query("version") version?: string,
    @Query("label") label?: string,
  ): Promise<ImportResult> {
    const gz = req.body as Buffer;
    if (!Buffer.isBuffer(gz) || gz.length === 0) {
      throw new BadRequestException("empty content pack body");
    }
    const parsed = version ? Number(version) : undefined;
    return this.svc.import(gz, {
      version:
        parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined,
      label: label ?? null,
    });
  }
}
