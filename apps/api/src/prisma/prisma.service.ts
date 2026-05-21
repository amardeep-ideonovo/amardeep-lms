import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-var-requires
import type { PrismaClient } from '@prisma/client';

// The shared @lms/db package exports a singleton PrismaClient. Reusing it keeps
// a single connection pool across the monorepo and respects the dev hot-reload
// guard defined there.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { prisma } = require('@lms/db') as { prisma: PrismaClient };

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  public readonly client: PrismaClient = prisma;

  // Convenience: expose model delegates directly so callers can do
  // `this.prisma.user.findMany()` exactly like a normal PrismaClient.
  get user() {
    return this.client.user;
  }
  get admin() {
    return this.client.admin;
  }
  get level() {
    return this.client.level;
  }
  get price() {
    return this.client.price;
  }
  get userLevel() {
    return this.client.userLevel;
  }
  get category() {
    return this.client.category;
  }
  get course() {
    return this.client.course;
  }
  get courseLevel() {
    return this.client.courseLevel;
  }
  get lesson() {
    return this.client.lesson;
  }
  get lessonProgress() {
    return this.client.lessonProgress;
  }
  get subscriptionMirror() {
    return this.client.subscriptionMirror;
  }
  get setting() {
    return this.client.setting;
  }

  get $transaction() {
    return this.client.$transaction.bind(this.client);
  }

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
