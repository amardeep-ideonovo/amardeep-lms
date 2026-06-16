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
  get levelCategory() {
    return this.client.levelCategory;
  }
  get price() {
    return this.client.price;
  }
  get userLevel() {
    return this.client.userLevel;
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
  get lessonNote() {
    return this.client.lessonNote;
  }
  get certificateTemplate() {
    return this.client.certificateTemplate;
  }
  get certificate() {
    return this.client.certificate;
  }
  get subscriptionMirror() {
    return this.client.subscriptionMirror;
  }
  get setting() {
    return this.client.setting;
  }
  get post() {
    return this.client.post;
  }
  get postCategory() {
    return this.client.postCategory;
  }
  get page() {
    return this.client.page;
  }
  get form() {
    return this.client.form;
  }
  get formSubmission() {
    return this.client.formSubmission;
  }
  get popup() {
    return this.client.popup;
  }
  get mediaAsset() {
    return this.client.mediaAsset;
  }
  get adminNotification() {
    return this.client.adminNotification;
  }
  get adminNotificationRead() {
    return this.client.adminNotificationRead;
  }
  get menu() {
    return this.client.menu;
  }
  get menuItem() {
    return this.client.menuItem;
  }
  get header() {
    return this.client.header;
  }
  get footer() {
    return this.client.footer;
  }
  get appConfig() {
    return this.client.appConfig;
  }
  get audience() {
    return this.client.audience;
  }
  get audienceField() {
    return this.client.audienceField;
  }
  get contact() {
    return this.client.contact;
  }
  get segment() {
    return this.client.segment;
  }
  get consentEvent() {
    return this.client.consentEvent;
  }
  get emailLog() {
    return this.client.emailLog;
  }
  get emailTemplate() {
    return this.client.emailTemplate;
  }
  get campaign() {
    return this.client.campaign;
  }
  get automation() {
    return this.client.automation;
  }
  get emailEvent() {
    return this.client.emailEvent;
  }
  get scheduledEmail() {
    return this.client.scheduledEmail;
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
