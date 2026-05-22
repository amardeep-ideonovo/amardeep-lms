// Dev/demo seed. Idempotent (fixed ids + upserts) so it can run repeatedly.
// NOTE: this is local convenience data only — unrelated to the WordPress migration.
// PAID level Stripe ids here are placeholders; real Products/Prices are created
// by the API's Levels module against Stripe. Checkout won't work on these fakes,
// but dashboard / access / lock-unlock all do.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // ----- Admin -----
  const adminPassword = "admin123";
  const admin = await prisma.admin.upsert({
    where: { email: "admin@example.com" },
    update: {},
    create: {
      email: "admin@example.com",
      passwordHash: await bcrypt.hash(adminPassword, 10),
      role: "SUPER_ADMIN",
    },
  });

  // ----- Levels -----
  const freeLevel = await prisma.level.upsert({
    where: { id: "seed-level-free" },
    update: {},
    create: {
      id: "seed-level-free",
      name: "Free",
      type: "FREE",
      mailchimpTag: "free",
    },
  });

  const proLevel = await prisma.level.upsert({
    where: { id: "seed-level-pro" },
    update: {},
    create: {
      id: "seed-level-pro",
      name: "Pro",
      type: "PAID",
      mailchimpTag: "pro",
      stripeProductId: "prod_seed_pro",
    },
  });

  await prisma.price.upsert({
    where: { stripePriceId: "price_seed_pro_monthly" },
    update: {},
    create: {
      id: "seed-price-pro-monthly",
      levelId: proLevel.id,
      stripePriceId: "price_seed_pro_monthly",
      interval: "month",
      amount: 1500, // $15.00
      currency: "usd",
    },
  });

  // ----- Member -----
  const memberPassword = "member123";
  const member = await prisma.user.upsert({
    where: { email: "member@example.com" },
    update: {},
    create: {
      email: "member@example.com",
      username: "member",
      passwordHash: await bcrypt.hash(memberPassword, 10),
    },
  });

  // Grant the member the Pro level manually (ACTIVE) so they can see unlocked content.
  await prisma.userLevel.upsert({
    where: {
      userId_levelId_source: {
        userId: member.id,
        levelId: proLevel.id,
        source: "MANUAL",
      },
    },
    update: { status: "ACTIVE" },
    create: {
      userId: member.id,
      levelId: proLevel.id,
      source: "MANUAL",
      status: "ACTIVE",
    },
  });

  // ----- Content -----
  const category = await prisma.category.upsert({
    where: { id: "seed-cat-start" },
    update: {},
    create: { id: "seed-cat-start", name: "Getting Started", order: 0 },
  });

  // Course A: open to everyone (no level assignments) -> always unlocked.
  const openCourse = await prisma.course.upsert({
    where: { id: "seed-course-open" },
    update: {},
    create: {
      id: "seed-course-open",
      title: "Welcome & Orientation",
      description: "Free intro course, open to all members.",
      categoryId: category.id,
      order: 0,
    },
  });

  // Course B: requires the Pro level -> locked unless the viewer holds Pro.
  const proCourse = await prisma.course.upsert({
    where: { id: "seed-course-pro" },
    update: {},
    create: {
      id: "seed-course-pro",
      title: "Pro Masterclass",
      description: "Premium content for Pro members.",
      categoryId: category.id,
      order: 1,
    },
  });
  await prisma.courseLevel.upsert({
    where: { courseId_levelId: { courseId: proCourse.id, levelId: proLevel.id } },
    update: {},
    create: { courseId: proCourse.id, levelId: proLevel.id },
  });

  // Lessons
  await prisma.lesson.upsert({
    where: { id: "seed-lesson-open-1" },
    update: {},
    create: {
      id: "seed-lesson-open-1",
      courseId: openCourse.id,
      title: "How this platform works",
      content: "Welcome! This lesson is open to everyone.",
      order: 0,
    },
  });
  await prisma.lesson.upsert({
    where: { id: "seed-lesson-pro-1" },
    update: {},
    create: {
      id: "seed-lesson-pro-1",
      courseId: proCourse.id,
      title: "Pro lesson 1",
      content: "This lesson is gated behind the Pro level.",
      order: 0,
    },
  });

  // ----- Blog -----
  const newsCat = await prisma.postCategory.upsert({
    where: { id: "seed-postcat-news" },
    update: {},
    create: {
      id: "seed-postcat-news",
      name: "Latest News",
      slug: "latest-news",
      order: 0,
    },
  });
  const featuredCat = await prisma.postCategory.upsert({
    where: { id: "seed-postcat-featured" },
    update: {},
    create: {
      id: "seed-postcat-featured",
      name: "Featured Stories",
      slug: "featured-stories",
      order: 1,
    },
  });

  // Three published posts (public, no login) + one draft (admin-only).
  await prisma.post.upsert({
    where: { id: "seed-post-welcome" },
    update: {},
    create: {
      id: "seed-post-welcome",
      slug: "welcome-to-the-new-member-portal",
      title: "Welcome to the new member portal",
      excerpt:
        "We've rebuilt the entire membership experience from the ground up.",
      content:
        "<p>We've rebuilt the entire membership experience from the ground up.</p><h2>What's new</h2><ul><li>A faster dashboard</li><li>A brand-new public blog</li><li>Cleaner course access</li></ul><p>Thanks for being a member!</p>",
      coverImageUrl: "https://picsum.photos/seed/welcome/1200/630",
      status: "PUBLISHED",
      publishedAt: new Date("2026-05-01T09:00:00Z"),
      authorId: admin.id,
      categoryId: newsCat.id,
      tags: ["announcement", "platform"],
    },
  });

  await prisma.post.upsert({
    where: { id: "seed-post-publishing" },
    update: {},
    create: {
      id: "seed-post-publishing",
      slug: "how-to-publish-your-book",
      title: "How to publish your book",
      excerpt: "A practical three-step path from manuscript to published.",
      content:
        "<p>Publishing your book is easier than you think.</p><h2>Three steps</h2><ol><li>Finish your manuscript</li><li>Edit ruthlessly</li><li>Choose a platform</li></ol><p>Then hit publish.</p>",
      coverImageUrl: "https://picsum.photos/seed/publishing/1200/630",
      status: "PUBLISHED",
      publishedAt: new Date("2026-05-08T09:00:00Z"),
      authorId: admin.id,
      categoryId: featuredCat.id,
      tags: ["writing", "guide"],
    },
  });

  await prisma.post.upsert({
    where: { id: "seed-post-writing" },
    update: {},
    create: {
      id: "seed-post-writing",
      slug: "how-to-write-your-book",
      title: "How to write your book",
      excerpt: "Every great book starts with a single sentence.",
      content:
        "<p>Every great book starts with a single sentence.</p><blockquote>Write drunk, edit sober.</blockquote><p>Set a daily word count and stick to it.</p>",
      coverImageUrl: "https://picsum.photos/seed/writing/1200/630",
      status: "PUBLISHED",
      publishedAt: new Date("2026-05-15T09:00:00Z"),
      authorId: admin.id,
      categoryId: newsCat.id,
      tags: ["writing"],
    },
  });

  // Draft: must NOT appear on the public blog, and its slug must 404 publicly.
  await prisma.post.upsert({
    where: { id: "seed-post-draft" },
    update: {},
    create: {
      id: "seed-post-draft",
      slug: "the-2026-roadmap",
      title: "Upcoming: our 2026 roadmap",
      excerpt: "A sneak peek at what we're planning (still a draft).",
      content:
        "<p>Here's a sneak peek at what we're planning for 2026. This post is still a <strong>draft</strong>.</p>",
      coverImageUrl: "https://picsum.photos/seed/roadmap/1200/630",
      status: "DRAFT",
      authorId: admin.id,
      categoryId: featuredCat.id,
      tags: ["roadmap"],
    },
  });

  // unused-var guard
  void freeLevel;

  console.log("Seed complete.");
  console.log(`  Admin:  admin@example.com / ${adminPassword}`);
  console.log(`  Member: member@example.com / ${memberPassword} (has Pro)`);
  console.log(`  Blog:   3 published posts + 1 draft, 2 categories`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
