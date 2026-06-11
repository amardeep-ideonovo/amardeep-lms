// Sentry must be loaded BEFORE any other module so it can patch
// http/express/db at require-time. This file is a no-op when SENTRY_DSN
// is unset, so it's safe to keep at the top in every environment.
import './instrument';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as express from 'express';
import { AppModule } from './app.module';
import { isProduction } from './common/env.util';
import { IMAGES_ROOT, IMAGES_ROUTE, ensureUploadDirs } from './blog/upload.config';
import { ensureLmsUploadDirs } from './lms/upload.config';
import { MEDIA_ROOT, MEDIA_ROUTE, ensureMediaDir } from './media/media.config';

async function bootstrap() {
  // bodyParser disabled here so we can register a raw-body parser for the
  // Stripe webhook route (signature verification needs the untouched payload),
  // and JSON everywhere else.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  // Trust X-Forwarded-* ONLY when explicitly behind a CDN / load balancer
  // (TRUST_PROXY="1" = hop count, "true" = whole chain, or an express preset
  // like "loopback"). Without it the throttler keys on the proxy's IP; but
  // trusting it on a directly-exposed API lets clients spoof X-Forwarded-For
  // and dodge per-IP rate limits — so the default is OFF.
  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy) {
    app.set(
      'trust proxy',
      trustProxy === 'true'
        ? true
        : /^\d+$/.test(trustProxy)
          ? Number(trustProxy)
          : trustProxy,
    );
  }

  // The PUBLIC form routes (read, submit, embed.js) must be embeddable on ANY
  // origin — a popup, an external site. Registered BEFORE enableCors so this
  // owns /forms preflight (responds to OPTIONS with `*`). For the real GET/POST
  // the global cors below may overwrite ACAO with the matching origin (still
  // valid) or leave our `*` (external origins). These routes carry no cookies.
  app.use(
    '/forms',
    (req: express.Request, res: express.Response, next: express.NextFunction) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        return res.end();
      }
      next();
    },
  );

  // Explicit allow-list from CORS_ORIGIN. In production an unset list means
  // NO cross-origin browser access — reflecting any origin with credentials
  // would let an arbitrary site ride a logged-in session. Dev stays open for
  // the local clients.
  const corsOrigins = process.env.CORS_ORIGIN?.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (!corsOrigins?.length && isProduction()) {
    // eslint-disable-next-line no-console
    console.warn('[api] CORS_ORIGIN unset — cross-origin requests disabled');
  }
  app.enableCors({
    origin: corsOrigins?.length ? corsOrigins : isProduction() ? false : true,
    credentials: true,
  });

  // Raw body ONLY for the Stripe webhook so the signature stays verifiable.
  app.use('/billing/webhook', express.raw({ type: '*/*' }));
  // JSON parsing for everything else.
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Serve uploaded blog images (see blog/upload.config.ts). On Render this
  // dir is ephemeral — set BLOG_IMAGES_DIR to a persistent disk for prod.
  ensureUploadDirs();
  ensureLmsUploadDirs();
  // Course/lesson images live under IMAGES_ROOT too, so this one static mount
  // serves them all. Lesson NOTE files are deliberately NOT served here — they
  // stream through an access-checked route (see LmsController).
  app.use(IMAGES_ROUTE, express.static(IMAGES_ROOT));

  // Media Library (Gallery): publicly served so each asset has an embeddable
  // URL. `nosniff` stops content-type confusion; SVGs are sanitized on upload.
  ensureMediaDir();
  app.use(
    MEDIA_ROUTE,
    express.static(MEDIA_ROOT, {
      setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
    }),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`[api] listening on :${port}`);
}

bootstrap();
