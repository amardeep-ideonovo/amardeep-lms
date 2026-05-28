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
import { IMAGES_ROOT, IMAGES_ROUTE, ensureUploadDirs } from './blog/upload.config';
import { ensureLmsUploadDirs } from './lms/upload.config';

async function bootstrap() {
  // bodyParser disabled here so we can register a raw-body parser for the
  // Stripe webhook route (signature verification needs the untouched payload),
  // and JSON everywhere else.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  // Trust X-Forwarded-* so req.ip is the real client IP behind a CDN / load
  // balancer. Without this, throttler keys all requests by the proxy's IP
  // and either no one gets rate-limited or everyone gets blocked together.
  app.set('trust proxy', true);

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

  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? true,
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
