// Dev/demo seed. Idempotent (fixed ids + upserts) so it can run repeatedly.
// NOTE: this is local convenience data only — unrelated to the WordPress migration.
// The "Pro" level here is a manual-grant DEMO with NO Stripe price, so it never
// appears as a purchasable plan on /pricing (a fake price id can't be checked
// out). Real PAID levels — with live Stripe Products/Prices — are created in the
// admin. Dashboard / access / lock-unlock all work from the manual grant below.
import { Prisma, PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// A short, public sample video (MP4) that plays in a browser <video> tag and
// in expo-av on mobile — no Mux account needed, so lessons "just play" in dev.
// Production videos are hosted on Vimeo; this is a public Vimeo test video.
const SAMPLE_VIDEO = "https://vimeo.com/1043569034";

// Deterministic sample images (picsum): square thumbnail + wide cover + a
// lesson thumbnail. Lets the new course/lesson images show out of the box.
const thumb = (key: string) => `https://picsum.photos/seed/${key}-thumb/600/600`;
const cover = (key: string) => `https://picsum.photos/seed/${key}-cover/1200/630`;
const lessonThumb = (key: string) =>
  `https://picsum.photos/seed/${key}-lt/640/400`;

async function ensureCourse(
  id: string,
  title: string,
  description: string,
  categoryId: string,
  order: number,
  images?: { thumbnailUrl?: string; coverImageUrl?: string }
) {
  return prisma.course.upsert({
    where: { id },
    // Apply images on re-seed too (undefined fields are left untouched).
    update: {
      thumbnailUrl: images?.thumbnailUrl,
      coverImageUrl: images?.coverImageUrl,
    },
    create: {
      id,
      title,
      description,
      categoryId,
      order,
      thumbnailUrl: images?.thumbnailUrl ?? null,
      coverImageUrl: images?.coverImageUrl ?? null,
    },
  });
}

async function ensureLesson(
  id: string,
  courseId: string,
  title: string,
  content: string,
  order: number,
  videoUrl?: string,
  thumbnailUrl?: string
) {
  return prisma.lesson.upsert({
    where: { id },
    update: { thumbnailUrl },
    create: {
      id,
      courseId,
      title,
      content,
      order,
      videoUrl: videoUrl ?? null,
      thumbnailUrl: thumbnailUrl ?? null,
    },
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
      mailchimpTags: ["free"],
    },
  });

  const proLevel = await prisma.level.upsert({
    where: { id: "seed-level-pro" },
    update: {},
    create: {
      id: "seed-level-pro",
      name: "Pro",
      type: "PAID",
      mailchimpTags: ["pro"],
    },
  });

  // Pro is a manual-grant demo (see the MANUAL UserLevel + gated "Pro
  // Masterclass" course below) and intentionally has NO Price. Clean up the
  // historical fake price if an older seed wrote it, so it can't surface as a
  // dead-end "Choose plan" button on /pricing.
  await prisma.price.deleteMany({
    where: { stripePriceId: "price_seed_pro_monthly" },
  });

  // ----- Member -----
  const memberPassword = "member123";
  const member = await prisma.user.upsert({
    where: { email: "member@example.com" },
    update: { firstName: "Member", lastName: "Example", phone: "+1 555 0100" },
    create: {
      email: "member@example.com",
      username: "member",
      passwordHash: await bcrypt.hash(memberPassword, 10),
      firstName: "Member",
      lastName: "Example",
      phone: "+1 555 0100",
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
    update: { thumbnailUrl: thumb("open"), coverImageUrl: cover("open") },
    create: {
      id: "seed-course-open",
      title: "Welcome & Orientation",
      description: "Free intro course, open to all members.",
      categoryId: category.id,
      order: 0,
      thumbnailUrl: thumb("open"),
      coverImageUrl: cover("open"),
    },
  });

  // Course B: requires the Pro level -> locked unless the viewer holds Pro.
  const proCourse = await prisma.course.upsert({
    where: { id: "seed-course-pro" },
    update: { thumbnailUrl: thumb("pro"), coverImageUrl: cover("pro") },
    create: {
      id: "seed-course-pro",
      title: "Pro Masterclass",
      description: "Premium content for Pro members.",
      categoryId: category.id,
      order: 1,
      thumbnailUrl: thumb("pro"),
      coverImageUrl: cover("pro"),
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
    SAMPLE_VIDEO,
    lessonThumb("open2")
  );

  // Fundamentals → two open courses with content; the first has a video.
  const prodCourse = await ensureCourse(
    "seed-course-prod",
    "Productivity Basics",
    "Build momentum with simple, repeatable habits.",
    fundamentals.id,
    0,
    { thumbnailUrl: thumb("prod"), coverImageUrl: cover("prod") }
  );
  await ensureLesson("seed-lesson-prod-1", prodCourse.id, "Plan your week (video)", "Start each week by writing down your top 3 outcomes.", 0, SAMPLE_VIDEO, lessonThumb("prod1"));
  await ensureLesson("seed-lesson-prod-2", prodCourse.id, "Time-blocking", "Reserve focused blocks for deep work and protect them.", 1);
  await ensureLesson("seed-lesson-prod-3", prodCourse.id, "Weekly review", "Reflect on what worked and adjust next week's plan.", 2);

  const toolingCourse = await ensureCourse(
    "seed-course-tooling",
    "Tooling & Setup",
    "Get your environment ready in minutes.",
    fundamentals.id,
    1,
    { thumbnailUrl: thumb("tooling"), coverImageUrl: cover("tooling") }
  );
  await ensureLesson("seed-lesson-tooling-1", toolingCourse.id, "Install the essentials", "A short checklist of tools to install first.", 0);
  await ensureLesson("seed-lesson-tooling-2", toolingCourse.id, "Configure your editor", "Settings that pay off every single day.", 1);

  // Advanced → one open course.
  const scalingCourse = await ensureCourse(
    "seed-course-scaling",
    "Scaling Your Workflow",
    "Patterns for when things get bigger.",
    advanced.id,
    0,
    { thumbnailUrl: thumb("scaling"), coverImageUrl: cover("scaling") }
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

  // ----- Pages (CMS / Puck) -----
  // One PUBLISHED page at /about built from Puck blocks, plus a DRAFT that must
  // 404 publicly. `data` is the Puck document rendered by the shared @lms/puck
  // config on the public site.
  await prisma.page.upsert({
    where: { id: "seed-page-about" },
    update: {},
    create: {
      id: "seed-page-about",
      slug: "about",
      title: "About Us",
      status: "PUBLISHED",
      publishedAt: new Date("2026-05-20T09:00:00Z"),
      authorId: admin.id,
      data: {
        root: {
          props: {
            seoTitle: "About Us",
            description: "Learn about our mission and what we offer.",
            ogImage: "",
          },
        },
        content: [
          {
            type: "Hero",
            props: {
              id: "Hero-1",
              eyebrow: "Who we are",
              title: "About Us",
              subtitle:
                "We help members learn, grow, and build lasting habits.",
              buttonLabel: "Browse courses",
              buttonHref: "/courses",
              align: "center",
              background: "muted",
            },
          },
          {
            type: "Heading",
            props: { id: "Heading-1", text: "Our mission", level: "2", align: "center" },
          },
          {
            type: "RichText",
            props: {
              id: "RichText-1",
              html: "<p>We started this community to make high-quality learning accessible to everyone. Our lessons are practical, concise, and built to help you make real progress.</p>",
              align: "center",
            },
          },
          {
            type: "Cards",
            props: {
              id: "Cards-1",
              columns: "3",
              items: [
                { title: "Practical lessons", text: "Short, focused lessons you can apply today." },
                { title: "Members-only", text: "Premium content behind your membership." },
                { title: "Learn anywhere", text: "Web and mobile, always in sync." },
              ],
            },
          },
          {
            type: "CTA",
            props: {
              id: "CTA-1",
              title: "Ready to start learning?",
              subtitle: "Join today and unlock every course.",
              buttonLabel: "Get started",
              buttonHref: "/login",
              background: "brand",
              align: "center",
            },
          },
        ],
        zones: {},
      } as Prisma.InputJsonValue,
    },
  });

  await prisma.page.upsert({
    where: { id: "seed-page-draft" },
    update: {},
    create: {
      id: "seed-page-draft",
      slug: "coming-soon",
      title: "Coming soon",
      status: "DRAFT",
      authorId: admin.id,
      data: {
        root: { props: { description: "" } },
        content: [
          {
            type: "Heading",
            props: { id: "Heading-1", text: "Coming soon", level: "1", align: "center" },
          },
        ],
        zones: {},
      } as Prisma.InputJsonValue,
    },
  });

  // ----- Popups (Puck overlay) -----
  // One ACTIVE popup targeted at the member dashboard so the feature is visible
  // out of the box. `update: {}` keeps any admin edits on re-seed. Built from
  // the SAME Puck blocks as pages. Turn it off in the admin Popups tab anytime.
  await prisma.popup.upsert({
    where: { id: "seed-popup-welcome" },
    update: {},
    create: {
      id: "seed-popup-welcome",
      name: "Welcome popup",
      status: "ACTIVE",
      position: "CENTER",
      width: "460px",
      background: "#ffffff",
      borderColor: "#e2e8f0",
      borderRadius: 16,
      padding: 28,
      showOnDashboard: true,
      pageMode: "NONE",
      data: {
        root: { props: {} },
        content: [
          {
            type: "Heading",
            props: {
              id: "Heading-1",
              text: "👋 Welcome back!",
              level: "2",
              align: "center",
            },
          },
          {
            type: "RichText",
            props: {
              id: "RichText-1",
              html: "<p>Thanks for being a member. Explore your courses and keep your streak going.</p>",
              align: "center",
            },
          },
          {
            type: "Button",
            props: {
              id: "Button-1",
              label: "Browse courses",
              href: "/dashboard",
              variant: "primary",
              align: "center",
              newTab: false,
            },
          },
        ],
        zones: {},
      } as Prisma.InputJsonValue,
    },
  });

  // unused-var guard
  void freeLevel;

  console.log("Seed complete.");
  console.log(`  Admin:  admin@example.com / ${adminPassword}`);
  console.log(
    `  Member: member@example.com / ${memberPassword} (has Pro via manual grant)`,
  );
  console.log(`  Blog:   3 published posts + 1 draft, 2 categories`);
  console.log(`  Pages:  1 published (/about) + 1 draft (coming-soon)`);
  console.log(`  Popups: 1 active (Welcome popup → dashboard)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
