import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as express from 'express';
import { AppModule } from './app.module';
import { IMAGES_ROOT, IMAGES_ROUTE, ensureUploadDirs } from './blog/upload.config';

async function bootstrap() {
  // bodyParser disabled here so we can register a raw-body parser for the
  // Stripe webhook route (signature verification needs the untouched payload),
  // and JSON everywhere else.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

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
