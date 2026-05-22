// Dev/demo seed. Idempotent (fixed ids + upserts) so it can run repeatedly.
// NOTE: this is local convenience data only — unrelated to the WordPress migration.
// PAID level Stripe ids here are placeholders; real Products/Prices are created
// by the API's Levels module against Stripe. Checkout won't work on these fakes,
// but dashboard / access / lock-unlock all do.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// A short, public sample video (MP4) that plays in a browser <video> tag and
// in expo-av on mobile — no Mux account needed, so lessons "just play" in dev.
const SAMPLE_VIDEO = "https://www.w3schools.com/html/mov_bbb.mp4";

async function ensureCourse(
  id: string,
  title: string,
  description: string,
  categoryId: string,
  order: number
) {
  return prisma.course.upsert({
    where: { id },
    update: {},
    create: { id, title, description, categoryId, order },
  });
}

async function ensureLesson(
  id: string,
  courseId: string,
  title: string,
  content: string,
  order: number,
  videoUrl?: string
) {
  return prisma.lesson.upsert({
    where: { id },
    update: {},
    create: { id, courseId, title, content, order, videoUrl: videoUrl ?? null },
  });
}

async function completeLesson(userId: string, lessonId: string) {
  await prisma.lessonProgress.upsert({
    where: { userId_lessonId: { userId, lessonId } },
    update: {},
    create: { userId, lessonId },
  });
}

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

  // ----- Sample courses for testing (multiple sections, content, a video) -----
  const fundamentals = await prisma.category.upsert({
    where: { id: "seed-cat-fundamentals" },
    update: {},
    create: { id: "seed-cat-fundamentals", name: "Fundamentals", order: 1 },
  });
  const advanced = await prisma.category.upsert({
    where: { id: "seed-cat-advanced" },
    update: {},
    create: { id: "seed-cat-advanced", name: "Advanced", order: 2 },
  });

  // A video lesson on the open course so any member can watch right away.
  await ensureLesson(
    "seed-lesson-open-2",
    openCourse.id,
    "Watch: a quick tour (video)",
    "A short sample video showing how a video lesson plays.",
    1,
    SAMPLE_VIDEO
  );

  // Fundamentals → two open courses with content; the first has a video.
  const prodCourse = await ensureCourse(
    "seed-course-prod",
    "Productivity Basics",
    "Build momentum with simple, repeatable habits.",
    fundamentals.id,
    0
  );
  await ensureLesson("seed-lesson-prod-1", prodCourse.id, "Plan your week (video)", "Start each week by writing down your top 3 outcomes.", 0, SAMPLE_VIDEO);
  await ensureLesson("seed-lesson-prod-2", prodCourse.id, "Time-blocking", "Reserve focused blocks for deep work and protect them.", 1);
  await ensureLesson("seed-lesson-prod-3", prodCourse.id, "Weekly review", "Reflect on what worked and adjust next week's plan.", 2);

  const toolingCourse = await ensureCourse(
    "seed-course-tooling",
    "Tooling & Setup",
    "Get your environment ready in minutes.",
    fundamentals.id,
    1
  );
  await ensureLesson("seed-lesson-tooling-1", toolingCourse.id, "Install the essentials", "A short checklist of tools to install first.", 0);
  await ensureLesson("seed-lesson-tooling-2", toolingCourse.id, "Configure your editor", "Settings that pay off every single day.", 1);

  // Advanced → one open course.
  const scalingCourse = await ensureCourse(
    "seed-course-scaling",
    "Scaling Your Workflow",
    "Patterns for when things get bigger.",
    advanced.id,
    0
  );
  await ensureLesson("seed-lesson-scaling-1", scalingCourse.id, "Automate the boring parts", "Identify repetitive tasks worth automating.", 0);
  await ensureLesson("seed-lesson-scaling-2", scalingCourse.id, "Delegate & document", "Write it down so others can run it without you.", 1);

  // Give the member partial progress so the progress bars are visibly non-zero.
  await completeLesson(member.id, "seed-lesson-open-1"); // Welcome & Orientation: 1 of 2
  await completeLesson(member.id, "seed-lesson-prod-1"); // Productivity Basics: 1 of 3

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
      categories: { connect: [{ id: newsCat.id }] },
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
      categories: { connect: [{ id: featuredCat.id }] },
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
      categories: { connect: [{ id: newsCat.id }] },
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
      categories: { connect: [{ id: featuredCat.id }] },
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
