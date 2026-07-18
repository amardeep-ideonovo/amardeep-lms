// Sentry must be loaded BEFORE any other module so it can patch
// http/express/db at require-time. This file is a no-op when SENTRY_DSN
// is unset, so it's safe to keep at the top in every environment.
import './instrument';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as express from 'express';
import { AppModule } from './app.module';
import { isProduction } from './common/env.util';
import { IMAGES_ROOT, IMAGES_ROUTE, ensureUploadDirs } from './blog/upload.config';
import { ensureLmsUploadDirs } from './lms/upload.config';
import { MEDIA_ROOT, MEDIA_ROUTE, ensureMediaDir } from './media/media.config';
import {
  CERT_FONTS_DIR,
  CERT_FONTS_ROUTE,
  ensureCertificateDirs,
} from './certificates/certificates.config';
import { RedisIoAdapter } from './projects/redis-io.adapter';
import { assertStorageDirsConfigured } from './storage/storage-dirs';

async function bootstrap() {
  // Before anything touches the disk: every writable storage dir must be an
  // explicit path in production. Left to its dev fallback the app would write
  // uploads into the container layer and lose them on the next recreate —
  // silently. Fail the boot instead, while someone is watching the deploy.
  assertStorageDirsConfigured(new Logger('StorageDirs'));

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

  // Raw body ONLY for the provider webhooks so signatures stay verifiable
  // (PayPal's verify-webhook-signature needs the byte-exact original body).
  app.use('/billing/webhook', express.raw({ type: '*/*' }));
  app.use('/billing/paypal/webhook', express.raw({ type: '*/*' }));
  // JSON parsing for everything else. The `verify` hook stashes the byte-exact
  // payload on req.rawBody for routes that ALSO need the parsed body — namely the
  // email feedback webhook, whose Svix (Resend) signature is computed over the raw
  // bytes while normalization still drives off the parsed @Body(). Cheap (a buffer
  // ref) and global, so it never changes how any existing route reads its body.
  app.use(
    express.json({
      limit: '1mb',
      verify: (req: express.Request & { rawBody?: Buffer }, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: true }));

  // Serve uploaded blog images (see blog/upload.config.ts). On Render this
  // dir is ephemeral — set BLOG_IMAGES_DIR to a persistent disk for prod.
  ensureUploadDirs();
  ensureLmsUploadDirs();
  // Course/lesson images live under IMAGES_ROOT too, so this one static mount
  // serves them all. Lesson NOTE files are deliberately NOT served here — they
  // stream through an access-checked route (see LmsController).
  // nosniff for parity with the /media + cert-fonts mounts — stops content-type
  // confusion on a mislabeled upload (defense-in-depth; only image extensions
  // are accepted here and filenames are server-generated).
  app.use(
    IMAGES_ROUTE,
    express.static(IMAGES_ROOT, {
      setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
    }),
  );

  // Media Library (Gallery): publicly served so each asset has an embeddable
  // URL. `nosniff` stops content-type confusion; SVGs are sanitized on upload.
  ensureMediaDir();
  app.use(
    MEDIA_ROUTE,
    express.static(MEDIA_ROOT, {
      setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
    }),
  );

  // Certificate fonts: immutable repo TTFs served publicly so the admin
  // template editor previews with the EXACT bytes the PDF renderer embeds.
  // Rendered certificate PDFs are deliberately NOT static — they stream via
  // an owner-checked route (CertificatesController).
  ensureCertificateDirs();
  app.use(
    CERT_FONTS_ROUTE,
    express.static(CERT_FONTS_DIR, {
      immutable: true,
      maxAge: '365d',
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

  // Realtime (Projects gateway). Use the Redis-backed Socket.IO adapter so
  // channel-room broadcasts fan out across API instances. If REDIS_URL is unset
  // or the connection can't be established, fall back to the default in-memory
  // adapter (single-instance only) so a boot never fails on the realtime layer.
  if (process.env.REDIS_URL) {
    try {
      const wsAdapter = new RedisIoAdapter(app);
      await wsAdapter.connectToRedis();
      app.useWebSocketAdapter(wsAdapter);
      // eslint-disable-next-line no-console
      console.log('[api] realtime: Redis Socket.IO adapter enabled');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[api] realtime: Redis adapter unavailable, using in-memory adapter — ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      '[api] realtime: REDIS_URL unset — using in-memory Socket.IO adapter (single instance only)',
    );
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`[api] listening on :${port}`);
}

bootstrap();
