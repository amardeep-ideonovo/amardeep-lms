// Dev/demo seed for "Unlocking Your Book" — idempotent (fixed ids + upserts
// with FULL update payloads, so a plain re-run restores every seeded row to
// spec; admin edits to seeded rows are intentionally reverted on re-seed).
//
// Destructive mode: SEED_WIPE=1 wipes ALL content tables (and the upload
// dirs on disk) before seeding. The wipe NEVER touches:
//   - Admin            (admin@example.com — the only way into the admin)
//   - Setting          (encrypted Stripe/PayPal/Mailchimp creds + provider —
//                       cannot be re-derived; paired with SETTINGS_ENC_KEY)
//   - _prisma_migrations
// NEVER run `prisma migrate reset` against this database — it drops those too.
//
//   SEED_WIPE=1 npm run seed -w @lms/db   # wipe + reseed (the only destructive path)
//   npm run seed -w @lms/db               # plain idempotent refresh (migrate-dev safe)
//
// QA fixtures: the BDD suite (packages/bdd/features/*.feature) hard-codes the
// ids/slugs/titles in seedFixtureCluster() — see the comment there before
// renaming anything.
import * as fs from "fs";
import * as path from "path";
import { Prisma, PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const WIPE = process.env.SEED_WIPE === "1";

// ---------- shared helpers ----------

// Public sample videos that play on web (Vimeo embed / native <video>) and
// mobile (WebView player / expo-video). Rotated across lessons for variety.
const VIDEOS = [
  "https://vimeo.com/1043569034", // proven public Vimeo test video
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
];
const TRAILER = VIDEOS[0]; // class trailers render in the web embed — keep Vimeo

// Deterministic sample images (picsum) so everything has art out of the box.
const thumb = (key: string) => `https://picsum.photos/seed/${key}-thumb/600/600`;
const cover = (key: string) => `https://picsum.photos/seed/${key}-cover/1200/630`;
const lessonThumb = (key: string) =>
  `https://picsum.photos/seed/${key}-lt/640/400`;
const skillImg = (key: string) => `https://picsum.photos/seed/${key}-sk/400/300`;
const avatarImg = (key: string) => `https://picsum.photos/seed/${key}-av/200/200`;

// Lesson bodies are PLAIN TEXT: the web lesson page renders {lesson.content}
// with white-space: pre-wrap and mobile uses a bare <Text> — HTML tags would
// display literally. Join paragraphs with blank lines only.
const paras = (...p: string[]) => p.join("\n\n");

// ---------- destructive wipe (SEED_WIPE=1 only) ----------

async function wipeDatabase() {
  console.log("SEED_WIPE=1 — wiping all content tables…");
  // Child → parent order. Most relations cascade, but being explicit keeps
  // this independent of cascade settings. Admin + Setting are PRESERVED.
  await prisma.$transaction([
    prisma.lessonProgress.deleteMany(),
    prisma.lessonNote.deleteMany(),
    prisma.lesson.deleteMany(),
    prisma.courseLevel.deleteMany(),
    prisma.course.deleteMany(),
    prisma.price.deleteMany(),
    prisma.userLevel.deleteMany(),
    prisma.level.deleteMany(),
    prisma.levelCategory.deleteMany(),
    prisma.subscriptionMirror.deleteMany(),
    prisma.formSubmission.deleteMany(),
    prisma.form.deleteMany(),
    prisma.popup.deleteMany(),
    prisma.post.deleteMany(),
    prisma.postCategory.deleteMany(),
    prisma.page.deleteMany(),
    prisma.menuItem.deleteMany(),
    prisma.menu.deleteMany(),
    prisma.header.deleteMany(),
    prisma.footer.deleteMany(),
    prisma.appConfig.deleteMany(),
    prisma.adminNotificationRead.deleteMany(),
    prisma.adminNotification.deleteMany(),
    prisma.user.deleteMany(),
    prisma.mediaAsset.deleteMany(),
  ]);
  console.log("  …database content wiped (Admin + Setting preserved).");
}

// Remove uploaded files from disk (gallery, blog/course/lesson images, lesson
// note attachments). Dot-files (.gitignore) are kept so the dirs stay in git.
function wipeUploadDirs() {
  const apiSrc = path.resolve(__dirname, "../../../apps/api/src");
  const imagesRoot = process.env.BLOG_IMAGES_DIR || path.join(apiSrc, "images");
  const dirs = [
    process.env.MEDIA_DIR || path.join(apiSrc, "media-uploads"),
    path.join(imagesRoot, "blog-post"),
    path.join(imagesRoot, "category"),
    path.join(imagesRoot, "course"),
    path.join(imagesRoot, "lesson"),
    path.join(imagesRoot, "page"),
    process.env.LESSON_FILES_DIR || path.join(apiSrc, "files", "lesson-notes"),
  ];
  let removed = 0;
  for (const dir of dirs) {
    try {
      for (const name of fs.readdirSync(dir)) {
        if (name.startsWith(".")) continue; // keep .gitignore etc.
        const p = path.join(dir, name);
        if (fs.statSync(p).isFile()) {
          fs.unlinkSync(p);
          removed++;
        }
      }
    } catch {
      /* missing dir — nothing to clean */
    }
  }
  console.log(`  …removed ${removed} uploaded file(s) from disk.`);
}

// ---------- QA / Stripe fixtures ----------
// The BDD suite hard-codes these (do NOT rename/remove without updating):
//   access_control.feature → level id seed-level-pro, course ids
//     seed-course-open / seed-course-pro, course title "Pro Masterclass",
//     lesson id seed-lesson-pro-1
//   blog.feature  → post slugs welcome-to-the-new-member-portal (PUBLISHED)
//                   and the-2026-roadmap (DRAFT)
//   pages.feature → page slugs about (PUBLISHED) and coming-soon (DRAFT)
//   popups.feature → page ID seed-page-about (INCLUDE targeting)
//   world.ts → admin@example.com/admin123, member@example.com/member123
// The fixture levels stay published:false so they never appear among the six
// real classes; "(QA fixture)" in the name explains any stray tile a BDD run
// leaves behind (the grant cleanup below removes it on the next re-seed).
// /checkout/stripe-test additionally needs the Stripe Test level + prices
// recreated with EXACT ids (apps/web/lib/checkout-config.ts hard-codes them).

async function seedFixtureCluster(): Promise<{ memberId: string }> {
  await prisma.level.upsert({
    where: { id: "seed-level-free" },
    update: { name: "Free (QA fixture)", type: "FREE", published: false },
    create: {
      id: "seed-level-free",
      name: "Free (QA fixture)",
      type: "FREE",
      published: false,
      mailchimpTags: ["free"],
    },
  });
  await prisma.level.upsert({
    where: { id: "seed-level-pro" },
    update: { name: "Pro (QA fixture)", type: "PAID", published: false },
    create: {
      id: "seed-level-pro",
      name: "Pro (QA fixture)",
      type: "PAID",
      published: false,
      mailchimpTags: ["pro"],
    },
  });

  // High order numbers sink the QA courses below the real catalog in flat lists.
  await prisma.course.upsert({
    where: { id: "seed-course-open" },
    update: {
      title: "Welcome & Orientation",
      description: "Open intro course available to every member (QA fixture).",
      order: 100,
      thumbnailUrl: thumb("qa-open"),
      coverImageUrl: cover("qa-open"),
    },
    create: {
      id: "seed-course-open",
      title: "Welcome & Orientation",
      description: "Open intro course available to every member (QA fixture).",
      order: 100,
      thumbnailUrl: thumb("qa-open"),
      coverImageUrl: cover("qa-open"),
    },
  });
  await prisma.course.upsert({
    where: { id: "seed-course-pro" },
    update: {
      title: "Pro Masterclass", // asserted by access_control.feature
      description: "Gated course used by the access-control tests (QA fixture).",
      order: 101,
      thumbnailUrl: thumb("qa-pro"),
      coverImageUrl: cover("qa-pro"),
    },
    create: {
      id: "seed-course-pro",
      title: "Pro Masterclass",
      description: "Gated course used by the access-control tests (QA fixture).",
      order: 101,
      thumbnailUrl: thumb("qa-pro"),
      coverImageUrl: cover("qa-pro"),
    },
  });
  await prisma.courseLevel.upsert({
    where: {
      courseId_levelId: { courseId: "seed-course-pro", levelId: "seed-level-pro" },
    },
    update: {},
    create: { courseId: "seed-course-pro", levelId: "seed-level-pro" },
  });

  const qaLessons: Array<{
    id: string;
    courseId: string;
    title: string;
    content: string;
    order: number;
    videoUrl: string | null;
  }> = [
    {
      id: "seed-lesson-open-1",
      courseId: "seed-course-open",
      title: "How this platform works",
      content: paras(
        "Welcome! This short orientation shows you around the member area: your dashboard, your classes, and where each lesson lives.",
        "Lessons are short on purpose. Watch the video, read the notes, and apply one thing before moving on.",
      ),
      order: 0,
      videoUrl: null,
    },
    {
      id: "seed-lesson-open-2",
      courseId: "seed-course-open",
      title: "Watch: a quick tour (video)",
      content: "A short sample video showing how a video lesson plays.",
      order: 1,
      videoUrl: VIDEOS[0],
    },
    {
      id: "seed-lesson-pro-1",
      courseId: "seed-course-pro",
      title: "Pro lesson 1",
      content: "This lesson is gated behind the Pro level (QA fixture).",
      order: 0,
      videoUrl: null,
    },
  ];
  for (const l of qaLessons) {
    await prisma.lesson.upsert({
      where: { id: l.id },
      update: {
        title: l.title,
        content: l.content,
        order: l.order,
        videoUrl: l.videoUrl,
        thumbnailUrl: lessonThumb(l.id),
      },
      create: { ...l, thumbnailUrl: lessonThumb(l.id) },
    });
  }

  // Member fixture (BDD creds). Password reset on every seed.
  const member = await prisma.user.upsert({
    where: { email: "member@example.com" },
    update: {
      passwordHash: await bcrypt.hash("member123", 10),
      firstName: "Member",
      lastName: "Example",
      phone: "+1 555 0100",
    },
    create: {
      email: "member@example.com",
      username: "member",
      passwordHash: await bcrypt.hash("member123", 10),
      firstName: "Member",
      lastName: "Example",
      phone: "+1 555 0100",
    },
  });

  // The LAST access_control scenario grants seed-level-pro and never revokes
  // it, which would surface a 7th "(QA fixture)" tile on the dashboard
  // (myClasses shows owned-but-unpublished levels). A re-seed clears it.
  await prisma.userLevel.deleteMany({
    where: { userId: member.id, levelId: "seed-level-pro" },
  });

  // Stripe live-checkout fixture — EXACT ids referenced by
  // apps/web/lib/checkout-config.ts CHECKOUT_LEVELS["stripe-test"] and tied to
  // real test-mode objects in the connected Stripe account.
  await prisma.level.upsert({
    where: { id: "cmpshpddy0002mtv65lh9p50c" },
    update: { name: "Stripe Test", type: "PAID", published: false },
    create: {
      id: "cmpshpddy0002mtv65lh9p50c",
      name: "Stripe Test",
      type: "PAID",
      published: false,
      mailchimpTags: [],
    },
  });
  await prisma.price.upsert({
    where: { id: "cmpshpddz0003mtv6j4e4i1lz" },
    update: { interval: "month", amount: 1000, currency: "usd", active: true },
    create: {
      id: "cmpshpddz0003mtv6j4e4i1lz",
      levelId: "cmpshpddy0002mtv65lh9p50c",
      stripePriceId: "price_1TcoZ0L80rvd0GTRyVsyoRqk",
      interval: "month",
      amount: 1000,
      currency: "usd",
      active: true,
    },
  });
  await prisma.price.upsert({
    where: { id: "cmputofx10005kzsobri0mddw" },
    update: { interval: "year", amount: 10000, currency: "usd", active: true },
    create: {
      id: "cmputofx10005kzsobri0mddw",
      levelId: "cmpshpddy0002mtv65lh9p50c",
      stripePriceId: "price_1TdPFuL80rvd0GTRJYnOWliT",
      interval: "year",
      amount: 10000,
      currency: "usd",
      active: true,
    },
  });

  return { memberId: member.id };
}

// ---------- the catalog: 6 published classes ----------

type LessonSeed = { title: string; minutes: number; seconds: number; body: string };
type CourseSeed = { key: string; title: string; description: string; lessons: LessonSeed[] };
type ClassSeed = {
  key: string;
  name: string;
  slug: string;
  type: "FREE" | "PAID";
  description: string;
  categories: string[]; // LevelCategory ids
  skills: string[];
  // [interval, amount, installments?][] — stripePriceId stays null (lazily
  // provisioned by the billing layer at first checkout).
  prices: Array<{ interval: "month" | "year"; amount: number; installments?: number }>;
  courses: CourseSeed[];
};

const L = (title: string, minutes: number, seconds: number, body: string): LessonSeed => ({
  title,
  minutes,
  seconds,
  body,
});

const CLASSES: ClassSeed[] = [
  {
    key: "foundations",
    name: "Book Writing Foundations",
    slug: "book-writing-foundations",
    type: "FREE",
    description:
      "Everything you need to go from “I've always wanted to write a book” to a working outline and a writing habit that sticks. Free for every member — start here.",
    categories: ["seed-lvlcat-writing", "seed-lvlcat-craft"],
    skills: [
      "Find the book only you can write",
      "Turn a vague idea into a one-sentence premise",
      "Build an outline that actually gets used",
      "Design a writing routine around a real life",
      "Beat the blank page with warm-up rituals",
    ],
    prices: [],
    courses: [
      {
        key: "foundations-1",
        title: "Start Your Book: From Idea to Outline",
        description:
          "Choose the right idea, sharpen it into a premise, and shape a working outline you can draft from.",
        lessons: [
          L(
            "Find the book only you can write",
            6,
            30,
            paras(
              "Most first books die because the writer picked an idea they admired instead of an idea they owned. In this lesson we separate the books you could write from the one book only you can write — the intersection of what you know deeply, what you care about, and what a reader needs.",
              "You'll make a short list of ten possible books, then run each through three filters: Do I have standing to write this? Will I still care in month six? Can I name the reader?",
              "By the end you'll have circled one idea — not forever, just for now. Commitment to a draft beats loyalty to a fantasy.",
            ),
          ),
          L(
            "Shape your premise in one sentence",
            8,
            15,
            paras(
              "A premise is a promise: who the book is for, what changes for them, and why you're the one writing it. If you can't say it in one breath, the manuscript will wander.",
              "We'll use a simple frame — “This is a book about X for Y, so that Z” — and iterate it out loud. You'll hear immediately which version has a pulse.",
              "Write your final sentence on a card and keep it where you draft. Every chapter either serves that sentence or gets cut.",
            ),
          ),
          L(
            "Build a working outline",
            11,
            20,
            paras(
              "An outline isn't a cage — it's scaffolding you can climb while the real building goes up. We'll build a flexible chapter map: the spine of your argument or story in 10 to 14 beats.",
              "For non-fiction, each beat is a transformation the reader makes. For memoir and fiction, each beat is a scene where something irreversible happens.",
              "Your outline is done when you can tell the whole book to a friend in five minutes without notes. That retelling — recorded and transcribed — is often your best first draft of the introduction.",
            ),
          ),
        ],
      },
      {
        key: "foundations-2",
        title: "The Daily Writing Habit",
        description:
          "Word counts, calendars and rituals that survive contact with a busy life.",
        lessons: [
          L(
            "Design a routine that sticks",
            7,
            45,
            paras(
              "Habits beat moods. The writers who finish aren't the ones who feel like writing — they're the ones with an appointment they keep. We'll design yours: same trigger, same place, same minimum.",
              "The minimum matters most. Two hundred words is a floor anyone can hit on the worst day, and floors — not ceilings — are what keep streaks alive.",
              "You'll leave this lesson with a written contract: days, time, place, minimum, and the one thing you'll give up to protect it.",
            ),
          ),
          L(
            "Beat the blank page",
            9,
            5,
            paras(
              "The blank page isn't a talent problem, it's a transition problem — your brain needs an on-ramp. We'll build a five-minute warm-up: re-read yesterday's last paragraph, write one ugly sentence, and only then write a real one.",
              "We'll also steal Hemingway's trick: stop mid-sentence while you still know what comes next, so tomorrow starts on rails.",
              "Perfectionism gets a containment zone, not a ban — you'll keep a “later list” where every mid-draft doubt gets parked instead of obeyed.",
            ),
          ),
          L(
            "Track progress without obsessing",
            5,
            50,
            paras(
              "What gets measured gets done — but measure the wrong thing and writing becomes a scoreboard you start avoiding. We track sessions kept, not words produced.",
              "You'll set up a simple calendar chain and a weekly fifteen-minute review: what moved, what stalled, what one change next week makes the chain easier to keep.",
              "When a week collapses (it will), the rule is the 48-hour restart: no make-up sessions, no guilt math — just the next appointment, kept.",
            ),
          ),
        ],
      },
    ],
  },
  {
    key: "memoir",
    name: "Memoir Masterclass",
    slug: "memoir-masterclass",
    type: "PAID",
    description:
      "Turn lived experience into a memoir readers can't put down. Mine your memories for scenes, handle the hard chapters with care, and structure decades of life into one story with a spine.",
    categories: ["seed-lvlcat-writing"],
    skills: [
      "Scene-building from memory",
      "Emotional truth on the page",
      "Ethical storytelling about real people",
      "Structuring decades into chapters",
      "Finding your narrator's voice",
    ],
    prices: [
      { interval: "month", amount: 2900 },
      { interval: "year", amount: 29000 },
    ],
    courses: [
      {
        key: "memoir-1",
        title: "Mining Your Memories",
        description:
          "Inventory the moments that matter and turn raw memory into scenes with heat.",
        lessons: [
          L(
            "The memory inventory",
            8,
            40,
            paras(
              "Before you can structure a memoir you need raw material on the table. We'll build a memory inventory: a hundred-item list of moments, images, rooms, smells and sentences you've never forgotten.",
              "Speed matters more than quality here — you're dredging, not curating. The list will surprise you: clusters will form around two or three wounds and wonders, and those clusters are your book.",
              "You'll finish by starring the ten memories that scare you a little. As Tristine Rainer says, the memoir lives where the heat is.",
            ),
          ),
          L(
            "Scenes vs. summary",
            10,
            15,
            paras(
              "Memoir fails when it explains and succeeds when it re-enacts. A scene puts the reader in the room: a specific day, real dialogue, objects you can touch. Summary connects scenes and compresses time.",
              "We'll take one starred memory and write it twice — once as summary, once as scene — and compare what each version makes the reader feel.",
              "The working ratio for most memoir is roughly 70% scene, 30% summary. You'll audit a favorite memoir chapter and see the rhythm: scene, breath, scene.",
            ),
          ),
          L(
            "Writing the hard chapters",
            12,
            30,
            paras(
              "Every memoir has chapters you've been avoiding for years. We'll approach them with protective equipment: write in third person first if you need distance, set a timer so the session has walls, and plan something kind for afterwards.",
              "You are allowed to write badly about important things. The first draft of a hard chapter is for you; revision is where it becomes for the reader.",
              "We'll also talk about when NOT to write a chapter yet — some stories need more healed distance, and the book can wait for them or work around them.",
            ),
          ),
        ],
      },
      {
        key: "memoir-2",
        title: "Truth, Memory & Ethics",
        description:
          "Whose story is it? Navigating real people, imperfect memory and the law of your own life.",
        lessons: [
          L(
            "Whose story is it?",
            9,
            20,
            paras(
              "You own your story — and your story overlaps with other people's. This lesson lays out the working ethics: write the truth as you experienced it, mark speculation as speculation, and give the people you love the dignity of complexity.",
              "We'll cover the practical options for protecting others: changed names, composite details, letting key figures read pages before publication — and the trade-offs of each.",
              "The test that keeps you honest: could you read this paragraph aloud with that person in the room? You don't need their approval — you need your own integrity.",
            ),
          ),
          L(
            "Composite characters and compressed time",
            7,
            55,
            paras(
              "Memory is already an editor: it compresses years and merges minor characters. Craft can do the same — openly. We'll cover when compositing and compression serve the reader, and how an author's note keeps the contract honest.",
              "The line you don't cross: inventing events that change the emotional truth. Rearranging furniture is craft; building a new house is fiction.",
              "You'll practice compressing a two-year stretch of your timeline into a single transitional page that loses nothing the reader needs.",
            ),
          ),
        ],
      },
      {
        key: "memoir-3",
        title: "Structuring a Life Story",
        description:
          "Theme as throughline, structures beyond chronology, and endings that earn their weight.",
        lessons: [
          L(
            "Theme is your throughline",
            8,
            5,
            paras(
              "A memoir is not an autobiography. You're not writing everything that happened — you're writing one question your life kept asking. That question is your theme, and it decides what stays.",
              "We'll extract your theme from the memory inventory: what do the starred memories argue about with each other? Belonging, escape, debt, forgiveness?",
              "Once named, the theme becomes a bouncer. Wonderful scenes that don't serve it wait outside for the next book.",
            ),
          ),
          L(
            "Braided and framed structures",
            11,
            45,
            paras(
              "Chronology is the default, not the law. A braided memoir weaves two or three timelines; a framed memoir tells the past from inside a present-day container; a thematic memoir moves room by room instead of year by year.",
              "We'll map your starred scenes onto each structure and see which arrangement creates the most tension with the least explaining.",
              "Structure is a promise about payoff — whichever shape you pick, the reader should feel the strands tightening toward each other by the middle of the book.",
            ),
          ),
          L(
            "Endings that earn their weight",
            6,
            40,
            paras(
              "A memoir can't end with “and then I kept living” — it ends when the question changes. Not solved: changed. The narrator knows something now that reframes every earlier chapter.",
              "We'll study three classic ending moves: the return (same place, new eyes), the release (the thing carried is set down), and the handoff (the story turns toward someone else's beginning).",
              "You'll draft your final image first — many memoirists write toward a destination photo. It's allowed to change; it's not allowed to be vague.",
            ),
          ),
        ],
      },
    ],
  },
  {
    key: "story",
    name: "Storytelling & Plot Essentials",
    slug: "storytelling-plot-essentials",
    type: "PAID",
    description:
      "The craft class for narrative drive: want and need, structure without formula, characters readers follow anywhere, and scenes that pull the page forward.",
    categories: ["seed-lvlcat-craft", "seed-lvlcat-writing"],
    skills: [
      "Build stakes readers feel",
      "Structure acts without formulas",
      "Write characters with desire lines",
      "Craft scenes with turn and consequence",
      "Dialogue that does double duty",
    ],
    prices: [{ interval: "month", amount: 2400 }],
    courses: [
      {
        key: "story-1",
        title: "The Shape of Story",
        description: "Want, need, stakes — and a three-act spine that breathes.",
        lessons: [
          L(
            "Want, need, and stakes",
            9,
            30,
            paras(
              "Every story engine has the same two pistons: what the character wants (the goal they'd name out loud) and what they need (the change they'd deny). Plot is what happens when pursuing the want collides with avoiding the need.",
              "Stakes aren't explosions — they're the answer to “what breaks if she fails?” We'll sharpen stakes until a reader could state them in one sentence.",
              "You'll fill out a one-page engine sheet for your protagonist and stress-test it: if the want is achievable in chapter two, or the need is already met, there is no book yet.",
            ),
          ),
          L(
            "Three acts without the formula",
            12,
            10,
            paras(
              "Act structure isn't a template to fill — it's a description of how pressure accumulates. Act one makes a promise, act two makes it expensive, act three makes it true.",
              "We'll mark the only three structural moments that are non-negotiable: the door that closes behind the protagonist, the midpoint reversal that changes the question, and the dark moment where the want and the need finally face each other.",
              "Then we'll map your outline against those moments — not to force scenes in, but to find where your draft's pressure leaks.",
            ),
          ),
        ],
      },
      {
        key: "story-2",
        title: "Characters Readers Follow",
        description: "Desire lines, voice and antagonists who think they're right.",
        lessons: [
          L(
            "Desire lines",
            8,
            25,
            paras(
              "Readers follow desire the way eyes follow motion. Every named character should want something on every page — even if it's a glass of water, as Vonnegut said.",
              "We'll chart your cast's desire lines and look for collisions: two sympathetic characters whose wants are mutually exclusive give you conflict without a villain.",
              "Flat secondary characters are almost always desireless characters. The fix is one specific want and one surprising line of dialogue.",
            ),
          ),
          L(
            "Voice on the page",
            10,
            0,
            paras(
              "Voice isn't decoration — it's worldview leaking through word choice. A character who calls a house a “property” and one who calls it a “home” see different worlds.",
              "We'll run the diary exercise: one paragraph about the same rainy morning in three characters' voices. No names allowed — if a reader can't tell who's who, the voices are still yours, not theirs.",
              "You'll build a small voice card per major character: pet phrases, what they notice first in a room, what they never say out loud.",
            ),
          ),
          L(
            "Antagonists with a point",
            7,
            15,
            paras(
              "A villain who's wrong about everything teaches the protagonist nothing. The antagonists that haunt readers are the ones who are right about something important.",
              "We'll write your antagonist's case in their own voice — a one-page letter justifying everything they do. Somewhere in that letter is a sentence you secretly agree with; that sentence is gold.",
              "Then we'll make the antagonist the hero of their own subplot: give them a want, a need and a wound, and watch every confrontation scene get sharper.",
            ),
          ),
        ],
      },
      {
        key: "story-3",
        title: "Scenes That Pull",
        description: "Scene-and-sequel rhythm and dialogue that earns its keep.",
        lessons: [
          L(
            "Scene and sequel",
            9,
            50,
            paras(
              "A scene is a unit of change: a character enters with a goal, meets resistance, and leaves worse off or changed. A sequel is the breath after — reaction, dilemma, decision — that launches the next scene.",
              "We'll dissect one of your existing scenes against the goal-conflict-disaster frame. If nothing changed by the end, it's not a scene yet; it's a setting with people in it.",
              "Pacing is just the ratio of scene to sequel. Thrillers run long scenes and short sequels; literary fiction often inverts it. You'll choose your default ratio on purpose.",
            ),
          ),
          L(
            "Dialogue that does double duty",
            8,
            35,
            paras(
              "Good dialogue does at least two jobs at once: it advances the scene's conflict AND reveals character. If a line only delivers information, it's narration wearing a costume.",
              "We'll practice subtext: characters who talk about the dishes while fighting about the marriage. The rule of thumb — people rarely say the thing; they say around the thing.",
              "You'll also learn the attribution diet: “said” is invisible, adverbs are confessions, and action beats place bodies in the room better than any dialogue tag.",
            ),
          ),
        ],
      },
    ],
  },
  {
    key: "editing",
    name: "Editing & Revision Bootcamp",
    slug: "editing-revision-bootcamp",
    type: "PAID",
    description:
      "The unglamorous superpower. Triage a messy draft, revise structure before sentences, and polish lines until they disappear — plus how to work with a professional editor.",
    categories: ["seed-lvlcat-craft"],
    skills: [
      "Triage a finished draft calmly",
      "Reverse-outline like an editor",
      "Cut darlings without bleeding",
      "Line-edit for rhythm and clarity",
      "Brief and work with a pro editor",
    ],
    prices: [
      { interval: "month", amount: 1900 },
      { interval: "year", amount: 19000 },
    ],
    courses: [
      {
        key: "editing-1",
        title: "The Big-Picture Revision",
        description: "Structure first: triage, reverse outlines and brave cuts.",
        lessons: [
          L(
            "Triage your draft",
            10,
            40,
            paras(
              "You finished a draft — do not start fixing commas. Revision runs top-down: story problems first, scene problems second, sentence problems last. Polishing a scene you'll later delete is how revisions eat years.",
              "We'll do a cold read-through with only three margin marks allowed: ✓ works, ? confusing, ✗ dead. No rewriting permitted on this pass — you're a surveyor, not a builder.",
              "The output is a one-page diagnosis: the three biggest structural problems, named bluntly. Everything else waits.",
            ),
          ),
          L(
            "The reverse outline",
            9,
            15,
            paras(
              "A reverse outline is the X-ray of the draft you actually wrote (not the one you meant to write). One line per scene: who wants what, what changes, why the next scene needs this one.",
              "Gaps announce themselves: scenes where nothing changes, chapters that repeat a beat, a middle where the protagonist goes passive for forty pages.",
              "We'll re-sequence on index cards before touching the manuscript. Moving a card costs nothing; moving ten thousand words hurts — do the cheap surgery first.",
            ),
          ),
          L(
            "Cutting your darlings",
            6,
            55,
            paras(
              "“Kill your darlings” doesn't mean delete what you love — it means delete what only you love. The test: does the book get worse for the READER without it, or just smaller for you?",
              "Every cut goes to a graveyard file, which makes the knife painless: nothing is destroyed, it's just benched. (You will almost never go back for any of it. That's the lesson.)",
              "We'll practice the 10% pass: whatever the draft's length, cut a tenth. The discipline isn't about the number — it's about discovering how much was scaffolding.",
            ),
          ),
        ],
      },
      {
        key: "editing-2",
        title: "Line Editing & Polish",
        description: "Sentence-level craft, a self-edit checklist, and working with pros.",
        lessons: [
          L(
            "Sentences that sing",
            8,
            50,
            paras(
              "Line editing is rhythm work. Read the paragraph aloud: where you stumble, the reader falls. We'll vary sentence length on purpose — long sentences carry thought, short ones land blows.",
              "The usual suspects get a sweep: weak verbs propped up by adverbs, nouns buried in “-tion” phrases, three adjectives doing the job of one specific noun.",
              "The goal isn't beautiful sentences — it's invisible ones. Prose is working when the reader forgets they're reading.",
            ),
          ),
          L(
            "Self-editing checklist",
            7,
            30,
            paras(
              "We'll assemble your personal pass list — because every writer has signature tics. Mine might be “just” and weather reports; yours might be characters who nod and smile every page.",
              "Run focused passes, one tic at a time: a “very/really/just” pass, a filter-words pass (saw, felt, noticed), an opening-paragraph pass across all chapters in one sitting.",
              "Then the format trick: change the font, export to your e-reader, or have the computer read it aloud. New container, new eyes — typos you've skimmed forty times suddenly wave.",
            ),
          ),
          L(
            "Working with an editor",
            11,
            5,
            paras(
              "Know what you're buying: a developmental edit interrogates the story, a line edit tunes the prose, a copyedit enforces correctness, and proofreading catches what survived. Buying them out of order wastes money.",
              "We'll write a one-page editorial brief: what the book is, who it's for, what you're worried about, and what kind of feedback helps you (and what shuts you down).",
              "When the edit letter arrives, the 48-hour rule applies: read it, close it, walk. The notes that still sting two days later are usually the true ones.",
            ),
          ),
        ],
      },
    ],
  },
  {
    key: "selfpub",
    name: "Self-Publishing Pro",
    slug: "self-publishing-pro",
    type: "PAID",
    description:
      "Your book, your imprint, your timeline. The complete production-and-launch system: choose your path, build a professional package, and run a launch week that sells books while you sleep.",
    categories: ["seed-lvlcat-publishing"],
    skills: [
      "Choose self vs. traditional vs. hybrid with clear eyes",
      "Budget a launch like a producer",
      "Commission covers that sell the genre",
      "Format interiors without tears",
      "Run a launch-team playbook",
      "Price and promo beyond launch week",
    ],
    prices: [
      // 6 monthly installments, then lifetime access — the installments demo.
      { interval: "month", amount: 9900, installments: 6 },
      { interval: "month", amount: 4900 },
    ],
    courses: [
      {
        key: "selfpub-1",
        title: "Your Publishing Roadmap",
        description: "Paths, money and a realistic production calendar.",
        lessons: [
          L(
            "Self vs. traditional vs. hybrid",
            10,
            20,
            paras(
              "There is no morally superior path — there are trade-offs. Traditional buys you distribution and validation and costs you years and control. Self-publishing buys you speed and royalties and costs you a second job as a producer.",
              "We'll score your specific book and goals across five axes: speed, control, budget, platform, and shelf-life. Niche non-fiction with an audience scores differently than a debut literary novel.",
              "Hybrid presses get a hard-eyed look too: the legitimate ones are transparent about costs; the predatory ones are flattery with an invoice. You'll get the checklist that tells them apart.",
            ),
          ),
          L(
            "Budgeting your launch",
            8,
            45,
            paras(
              "A professional indie book typically needs four line items: editing, cover, interior, and marketing seed money. We'll price each at economy, standard and premium tiers so you can budget on purpose instead of by surprise.",
              "The order of spending matters: editing is the last place to cut, covers are judged in thumbnail size, and most paid marketing is wasted before you have reviews.",
              "You'll build your production calendar backwards from a launch date — with the two buffers everyone forgets: proof copies take time, and editors book out months ahead.",
            ),
          ),
        ],
      },
      {
        key: "selfpub-2",
        title: "Production: Covers, Interiors, ISBNs",
        description: "The package readers judge before they read a word.",
        lessons: [
          L(
            "Covers that sell the genre",
            9,
            40,
            paras(
              "Your cover's job is not to depict your book — it's to signal its genre at thumbnail size in under a second. Readers buy what looks like the last thing they loved.",
              "We'll build a comp board of the current top fifty in your category and extract the visual grammar: typography weight, palette, imagery, where the author name sits.",
              "Then: how to brief a designer (comps, not adjectives), what rights to ask for, and the three thumbnail tests a cover must pass before you approve it.",
            ),
          ),
          L(
            "Interior formatting without tears",
            12,
            0,
            paras(
              "Interiors are where amateur books expose themselves: cramped margins, widows and orphans, fourteen fonts. The good news — modern tools (Vellum, Atticus, even clean templates) make professional interiors a day's work.",
              "We'll set the non-negotiables: consistent chapter openers, readable trim-size-appropriate type, front matter in the right order, and a back matter that sells your next book.",
              "Print and ebook are different animals: fixed pages versus reflowing text. You'll produce both from one master file and check each on real devices and a real proof copy.",
            ),
          ),
          L(
            "Metadata, ISBNs and categories",
            7,
            50,
            paras(
              "Metadata is invisible marketing. Your title, subtitle, description, keywords and categories decide whether the right reader ever sees the cover you paid for.",
              "We'll write a description that sells (hook, stakes, social proof, call to action — not a synopsis), choose seven keywords readers actually type, and pick categories where you can realistically rank.",
              "ISBNs, imprint names and the own-vs-free decision get sorted too: owning your ISBN means owning your publisher identity across every store.",
            ),
          ),
        ],
      },
      {
        key: "selfpub-3",
        title: "Launch Week",
        description: "The playbook: review teams, pricing, promos and the long tail.",
        lessons: [
          L(
            "The launch-team playbook",
            9,
            10,
            paras(
              "A launch team is a small group of readers who get the book early in exchange for honest reviews in week one. Reviews are the currency — stores and readers both count them.",
              "We'll recruit from your warmest circles (newsletter, clients, writing groups), onboard them with dates and a one-page guide, and make review-leaving embarrassingly easy.",
              "The cadence: advance copies four weeks out, a reminder at launch, a thank-you with the review link the day after. Twenty genuine reviews in week one changes a book's trajectory.",
            ),
          ),
          L(
            "Pricing and promos",
            8,
            20,
            paras(
              "Pricing is positioning. We'll cover the standard indie ladders: a launch-week price that rewards early buyers, the 2.99–5.99 ebook sweet spots, and print pricing that survives store cuts.",
              "Promo sites and countdown deals get a sober review — which ones still move copies, and why stacking three small promos beats one big one.",
              "The metric that matters isn't launch-day rank; it's the read-through and the email signups. A launch is an audience-building event wearing a sales costume.",
            ),
          ),
          L(
            "After the launch",
            6,
            30,
            paras(
              "Week two is where most indie books die quietly — and where pros go to work. The long tail runs on three engines: also-boughts, your email list, and the next book.",
              "We'll set a 90-day rhythm: one promo a month, one piece of evergreen content a week, and a quarterly price experiment with actual notes.",
              "And the most reliable marketing for book one is writing book two. Series momentum is the closest thing publishing has to compound interest.",
            ),
          ),
        ],
      },
    ],
  },
  {
    key: "platform",
    name: "Author Platform & Marketing",
    slug: "author-platform-marketing",
    type: "PAID",
    description:
      "Build the audience before you need it. A working author website, a newsletter engine that grows weekly, social that doesn't eat your writing time, and ads that pay for themselves.",
    categories: ["seed-lvlcat-marketing", "seed-lvlcat-publishing"],
    skills: [
      "Ship an author site in a weekend",
      "Grow a newsletter with a reader magnet",
      "Run a sustainable social cadence",
      "Read Amazon ads data without panic",
      "Build funnels that sell the backlist",
    ],
    prices: [
      { interval: "month", amount: 2500 },
      { interval: "year", amount: 25000 },
    ],
    courses: [
      {
        key: "platform-1",
        title: "Build Your Author Platform",
        description: "Website, newsletter and a social presence that serves the books.",
        lessons: [
          L(
            "Your author website in a weekend",
            11,
            30,
            paras(
              "An author site has exactly four jobs: say who you are, show the books, capture emails, and give media a press page. Everything else is decoration — ship the four jobs first.",
              "We'll wireframe the five pages that matter (home, books, about, contact, newsletter) and write the home page above-the-fold line: one sentence, one button.",
              "Perfection is the enemy here. A simple live site collecting emails this weekend beats the redesign you'll finish someday.",
            ),
          ),
          L(
            "The newsletter engine",
            9,
            55,
            paras(
              "Your email list is the only audience you own. Social platforms rent you reach and change the locks whenever they like; the list goes wherever you go.",
              "We'll build the engine: a reader magnet (novella, checklist, first three chapters) traded for an address, a welcome sequence that introduces you in three emails, and a sustainable cadence — monthly is plenty.",
              "Write to one reader, not “my list.” The unsubscribes you'll obsess over are the system working: the room slowly fills with the right people.",
            ),
          ),
          L(
            "Social without the burnout",
            7,
            40,
            paras(
              "You don't need to be everywhere — you need to be findable in one place your readers already are. We'll choose a primary platform by audience, not by trend.",
              "The sustainable cadence is the one you can keep in a deadline month: three posts a week from a simple rotation (process, life, book) batched in one sitting.",
              "Hard rule: social feeds the newsletter, the newsletter sells the books. If a platform stops sending people up that ladder, you're allowed to leave.",
            ),
          ),
        ],
      },
      {
        key: "platform-2",
        title: "Selling More Books",
        description: "Amazon ads fundamentals and reader funnels that compound.",
        lessons: [
          L(
            "Amazon ads fundamentals",
            12,
            25,
            paras(
              "Amazon ads are a vending machine with a learning curve: you put in money and keywords, and the data tells you what readers actually search. We'll start with low-budget auto campaigns purely as research.",
              "Then the harvest: move the converting search terms into manual campaigns, bid down the browsers, bid up the buyers. ACOS targets depend on your goal — visibility, break-even, or profit.",
              "The discipline is weekly fifteen-minute reviews, not daily panic. Ads reward boring consistency and punish enthusiastic fiddling.",
            ),
          ),
          L(
            "Reader magnets and funnels",
            8,
            55,
            paras(
              "A funnel is just a kind path from stranger to superfan: free taste, email relationship, fair offer. For novelists that's magnet → welcome sequence → series starter; for non-fiction, checklist → case-study emails → flagship book or course.",
              "We'll map your funnel on one page and find the leak — usually the handoff between the free thing and the first ask.",
              "Then we wire the back matter: every book's final pages should invite the reader one step deeper. The cheapest marketing you'll ever run is a link in a book someone just loved.",
            ),
          ),
        ],
      },
    ],
  },
];

async function seedCatalog() {
  // Categories shown as chips on class tiles and landing pages.
  const cats: Array<[string, string, number]> = [
    ["seed-lvlcat-writing", "Writing", 0],
    ["seed-lvlcat-craft", "Craft", 1],
    ["seed-lvlcat-publishing", "Publishing", 2],
    ["seed-lvlcat-marketing", "Marketing", 3],
  ];
  for (const [id, name, order] of cats) {
    await prisma.levelCategory.upsert({
      where: { id },
      update: { name, order },
      create: { id, name, order },
    });
  }

  let lessonIndex = 0; // rotates video URLs across the whole catalog
  for (const cls of CLASSES) {
    const levelId = `seed-class-${cls.key}`;
    const firstCourseId = `seed-course-${cls.courses[0].key}`;
    const levelData = {
      name: cls.name,
      slug: cls.slug,
      published: true,
      type: cls.type,
      description: cls.description,
      imageUrl: cover(cls.slug),
      trailerUrl: TRAILER,
      mailchimpTags: [cls.slug],
      skills: cls.skills.map((title, i) => ({
        title,
        imageUrl: skillImg(`${cls.key}-${i}`),
      })) as Prisma.InputJsonValue,
    };

    // Level first (CourseLevel joins need it), but WITHOUT featuredCourseId —
    // that FK points at a course that doesn't exist yet; backfilled below.
    await prisma.level.upsert({
      where: { id: levelId },
      update: { ...levelData, categories: { set: cls.categories.map((id) => ({ id })) } },
      create: {
        id: levelId,
        ...levelData,
        categories: { connect: cls.categories.map((id) => ({ id })) },
      },
    });

    for (let c = 0; c < cls.courses.length; c++) {
      const course = cls.courses[c];
      const courseId = `seed-course-${course.key}`;
      await prisma.course.upsert({
        where: { id: courseId },
        update: {
          title: course.title,
          description: course.description,
          order: c,
          thumbnailUrl: thumb(course.key),
          coverImageUrl: cover(course.key),
        },
        create: {
          id: courseId,
          title: course.title,
          description: course.description,
          order: c,
          thumbnailUrl: thumb(course.key),
          coverImageUrl: cover(course.key),
        },
      });
      await prisma.courseLevel.upsert({
        where: { courseId_levelId: { courseId, levelId } },
        update: {},
        create: { courseId, levelId },
      });
      for (let l = 0; l < course.lessons.length; l++) {
        const lesson = course.lessons[l];
        const lessonId = `seed-lesson-${course.key}-${l + 1}`;
        const payload = {
          title: lesson.title,
          content: lesson.body,
          order: l,
          videoUrl: VIDEOS[lessonIndex % VIDEOS.length],
          thumbnailUrl: lessonThumb(`${course.key}-${l + 1}`),
          durationSeconds: lesson.minutes * 60 + lesson.seconds,
        };
        lessonIndex++;
        await prisma.lesson.upsert({
          where: { id: lessonId },
          update: payload,
          create: { id: lessonId, courseId, ...payload },
        });
      }
    }

    // Backfill the featured course now that it exists.
    await prisma.level.update({
      where: { id: levelId },
      data: { featuredCourseId: firstCourseId },
    });

    // Prices: stripePriceId/paypalPlanId stay untouched on update so ids the
    // billing layer lazily provisioned at checkout are never orphaned.
    for (let p = 0; p < cls.prices.length; p++) {
      const price = cls.prices[p];
      const priceId = `seed-price-${cls.key}-${p + 1}`;
      await prisma.price.upsert({
        where: { id: priceId },
        update: {
          interval: price.interval,
          amount: price.amount,
          currency: "usd",
          active: true,
          installments: price.installments ?? null,
        },
        create: {
          id: priceId,
          levelId,
          stripePriceId: null,
          interval: price.interval,
          amount: price.amount,
          currency: "usd",
          active: true,
          installments: price.installments ?? null,
        },
      });
    }
  }
}

// Member demo state: enrolled in two classes with visible progress, so the
// dashboard opens on "Welcome back" with a non-zero continue-learning hero.
async function seedMemberState(memberId: string) {
  for (const levelId of ["seed-class-foundations", "seed-class-memoir"]) {
    await prisma.userLevel.upsert({
      where: {
        userId_levelId_source: { userId: memberId, levelId, source: "MANUAL" },
      },
      update: { status: "ACTIVE", expiresAt: null },
      create: { userId: memberId, levelId, source: "MANUAL", status: "ACTIVE" },
    });
  }
  for (const lessonId of [
    "seed-lesson-foundations-1-1",
    "seed-lesson-foundations-1-2",
    "seed-lesson-memoir-1-1",
  ]) {
    await prisma.lessonProgress.upsert({
      where: { userId_lessonId: { userId: memberId, lessonId } },
      update: {},
      create: { userId: memberId, lessonId },
    });
  }
}

// ---------- blog ----------

async function seedBlog(adminId: string) {
  const cats: Array<[string, string, string, number]> = [
    ["seed-postcat-news", "Latest News", "latest-news", 0],
    ["seed-postcat-featured", "Featured Stories", "featured-stories", 1],
    ["seed-postcat-writing-tips", "Writing Tips", "writing-tips", 2],
    ["seed-postcat-publishing", "Publishing", "publishing", 3],
    ["seed-postcat-author-life", "Author Life", "author-life", 4],
  ];
  for (const [id, name, slug, order] of cats) {
    await prisma.postCategory.upsert({
      where: { id },
      update: { name, slug, order },
      create: { id, name, slug, order },
    });
  }

  type PostSeed = {
    id: string;
    slug: string;
    title: string;
    excerpt: string;
    content: string;
    status: "PUBLISHED" | "DRAFT";
    publishedAt: string | null;
    categoryIds: string[];
    tags: string[];
  };
  const posts: PostSeed[] = [
    // ----- QA fixtures (slugs asserted by blog.feature) -----
    {
      id: "seed-post-welcome",
      slug: "welcome-to-the-new-member-portal",
      title: "Welcome to the new member portal",
      excerpt:
        "Unlocking Your Book has a new home — faster, cleaner, and built around your writing.",
      content:
        "<p>Welcome to the new Unlocking Your Book member portal — rebuilt from the ground up around the way working writers actually learn.</p><h2>What's new</h2><ul><li>A classes-first dashboard that remembers where you left off</li><li>Every lesson on web and mobile, always in sync</li><li>A brand-new public blog with weekly craft and publishing articles</li></ul><p>Log in, pick up your class, and keep writing. We'll handle the rest.</p>",
      status: "PUBLISHED",
      publishedAt: "2026-05-01T09:00:00Z",
      categoryIds: ["seed-postcat-news"],
      tags: ["announcement", "platform"],
    },
    {
      id: "seed-post-draft",
      slug: "the-2026-roadmap",
      title: "Upcoming: our 2026 roadmap",
      excerpt: "A sneak peek at what we're planning (still a draft).",
      content:
        "<p>Here's a sneak peek at what we're planning for 2026. This post is still a <strong>draft</strong>.</p>",
      status: "DRAFT",
      publishedAt: null,
      categoryIds: ["seed-postcat-featured"],
      tags: ["roadmap"],
    },
    // ----- real content -----
    {
      id: "seed-post-first-draft",
      slug: "how-to-finish-your-first-draft-in-90-days",
      title: "How to finish your first draft in 90 days",
      excerpt:
        "Not by writing faster — by deciding more before you start and quitting less in the middle.",
      content:
        "<p>Ninety days is enough time to draft a book. Not to write a <em>good</em> book — drafts aren't supposed to be good, they're supposed to be <strong>done</strong>. Here's the system our members use.</p><h2>Weeks 1–2: decide everything you can</h2><p>Most mid-draft quitting is really mid-draft <em>deciding</em>. Lock your premise in one sentence, sketch a 12-beat outline, and write your ending's final image first. You're allowed to change these later; you're not allowed to start without them.</p><h2>Weeks 3–12: protect the floor</h2><ul><li>Set a daily minimum so small it's embarrassing (200 words)</li><li>Stop mid-sentence so tomorrow starts on rails</li><li>Park every doubt on a “later list” instead of obeying it</li><li>Miss a day? The streak restarts within 48 hours, no make-up math</li></ul><p>At 500 words a day, five days a week, you'll cross 30,000 words by week ten — which is when the draft starts pulling you instead of you pushing it.</p><h2>The only rule that matters</h2><p>Forward, never back. Revision is a different sport, played after the whistle. The draft's one job is to exist.</p>",
      status: "PUBLISHED",
      publishedAt: "2026-05-05T09:00:00Z",
      categoryIds: ["seed-postcat-writing-tips"],
      tags: ["drafting", "habits", "productivity"],
    },
    {
      id: "seed-post-author-voice",
      slug: "finding-your-author-voice",
      title: "Finding your author voice (it's not what you think)",
      excerpt:
        "Voice isn't something you find — it's what's left when you stop imitating and start noticing.",
      content:
        "<p>New writers hunt for their “voice” like it's a lost wallet. But voice isn't found — it's <em>uncovered</em>, and the tools are unglamorous: volume, honesty, and noticing.</p><h2>Voice is worldview leaking through word choice</h2><p>Two writers describe the same kitchen. One sees “granite counters, barely used.” The other sees “the kind of kitchen that gets photographed more than cooked in.” Same room, different mind. That difference is voice.</p><h2>Three exercises that uncover it</h2><ol><li><strong>The rant transcript.</strong> Record yourself explaining something you care about to a friend. Transcribe it. That rhythm — those run-ons, those jokes — is closer to your voice than anything you've typed.</li><li><strong>The imitation purge.</strong> Write one page deliberately imitating your favorite author. Getting it out of your system on purpose stops it leaking out by accident.</li><li><strong>The notice list.</strong> For one week, write down the first thing you notice in every room. Your attention has a signature; your prose inherits it.</li></ol><p>Stop auditioning. The readers who are yours will recognize you the moment you sound like yourself.</p>",
      status: "PUBLISHED",
      publishedAt: "2026-05-12T09:00:00Z",
      categoryIds: ["seed-postcat-writing-tips"],
      tags: ["voice", "craft"],
    },
    {
      id: "seed-post-selfpub-vs-trad",
      slug: "self-publishing-vs-traditional-an-honest-look",
      title: "Self-publishing vs. traditional: an honest look",
      excerpt:
        "No tribalism, no horror stories — just the actual trade-offs, and a way to decide for your book.",
      content:
        "<p>The publishing-path debate generates more heat than light. Here's the honest version: <strong>both paths work, for different books and different authors.</strong></p><h2>What traditional really buys you</h2><p>Distribution into physical bookstores, an advance (median: modest), professional editing and design at no upfront cost, and the validation that still opens certain doors. The price: querying season, contract terms, a 18–30 month timeline, and creative control shared with a committee.</p><h2>What self-publishing really buys you</h2><p>Speed (months, not years), 35–70% royalties instead of 8–15%, total creative control, and a direct line to your readers. The price: you become the producer — hiring editors and designers, managing metadata and marketing, and funding it all upfront.</p><h2>A quick scoring exercise</h2><ul><li>Niche non-fiction with an existing audience → self-publishing usually wins on math alone</li><li>Debut literary fiction → traditional's curation and prizes still matter</li><li>Genre fiction written fast in a series → indie royalties compound</li><li>One beautiful book you want in libraries → traditional's distribution is hard to replicate</li></ul><p>Choose with a spreadsheet, not an identity. And remember: it's a per-book decision, not a marriage. Hybrid careers are now the norm among working authors.</p>",
      status: "PUBLISHED",
      publishedAt: "2026-05-19T09:00:00Z",
      categoryIds: ["seed-postcat-publishing"],
      tags: ["self-publishing", "traditional", "strategy"],
    },
    {
      id: "seed-post-platform-before-launch",
      slug: "build-your-author-platform-before-you-launch",
      title: "Build your author platform before you need it",
      excerpt:
        "The worst time to start building an audience is launch week. The best time is while you're still writing.",
      content:
        "<p>Every month, an author finishes a wonderful book, looks up, and discovers they have no one to tell. Platform-building feels like a distraction from writing — until launch week, when it's suddenly the only thing that matters.</p><h2>Platform is permission, not popularity</h2><p>A platform isn't follower counts. It's a group of people who have given you permission to tell them about your work. One thousand engaged newsletter subscribers outsell fifty thousand passive followers, every time.</p><h2>The minimum viable platform</h2><ol><li><strong>A simple website</strong> — who you are, what you write, one button to subscribe</li><li><strong>A newsletter</strong> — monthly is plenty; consistency beats frequency</li><li><strong>A reader magnet</strong> — a novella, a checklist, three chapters — traded for an email address</li><li><strong>One social platform</strong> — wherever your readers already gather, fed on a sustainable cadence</li></ol><h2>Fifteen minutes a day</h2><p>While drafting, platform work gets fifteen minutes a day, no more: answer one reader email, share one process note, invite one person to the list. Two years of fifteen-minute days is how “overnight” launch successes are actually built.</p>",
      status: "PUBLISHED",
      publishedAt: "2026-05-26T09:00:00Z",
      categoryIds: ["seed-postcat-author-life", "seed-postcat-publishing"],
      tags: ["platform", "marketing", "newsletter"],
    },
    {
      id: "seed-post-memoir-toolkit",
      slug: "the-memoir-writers-toolkit",
      title: "The memoir writer's toolkit",
      excerpt:
        "Five tools for turning lived experience into a story strangers will care about.",
      content:
        "<p>Memoir is the hardest easy-looking genre: the material is all there, and that's exactly the problem. These five tools separate a memoir from a diary.</p><h2>1. The memory inventory</h2><p>List one hundred moments you've never forgotten — fast, uncurated. Clusters will form around two or three wounds and wonders. Those clusters are your book; the rest is biography.</p><h2>2. The scene/summary dial</h2><p>Scenes re-enact (a specific day, real dialogue, objects you can touch); summary compresses. Most working memoir runs about 70% scene. If a chapter explains more than it shows, the dial has drifted.</p><h2>3. The theme bouncer</h2><p>A memoir is one question your life kept asking — belonging, escape, forgiveness. Name it, write it on a card, and let it bounce every wonderful scene that doesn't serve it.</p><h2>4. The dignity test</h2><p>For every real person on your pages: could you read that paragraph aloud with them in the room? You don't need their approval — you need your own integrity, and complexity is kinder than caricature.</p><h2>5. The protective gear</h2><p>For the hard chapters: third person first if you need distance, a timer so the session has walls, something kind planned for after. You're allowed to write badly about important things — revision is where it becomes for the reader.</p>",
      status: "PUBLISHED",
      publishedAt: "2026-06-02T09:00:00Z",
      categoryIds: ["seed-postcat-writing-tips", "seed-postcat-featured"],
      tags: ["memoir", "craft", "toolkit"],
    },
    {
      id: "seed-post-publish-checklist",
      slug: "from-manuscript-to-published-the-complete-checklist",
      title: "From manuscript to published: the complete checklist",
      excerpt:
        "Every step between “the draft is done” and “the book is live”, in order, with nothing forgotten.",
      content:
        "<p>The distance between a finished manuscript and a published book is about forty small decisions. Here they are in order — print this.</p><h2>Edit (8–12 weeks)</h2><ol><li>Cool-down: four weeks minimum in a drawer</li><li>Self-revision: structure first, sentences last</li><li>Developmental edit or beta readers (pick your poison)</li><li>Line edit, copyedit, then — after layout — proofread</li></ol><h2>Produce (4–8 weeks)</h2><ol><li>Cover brief built from a fifty-book comp board</li><li>Interior formatting: print and ebook from one master</li><li>ISBNs (own them), imprint name, copyright page</li><li>Metadata: description that sells, seven real keywords, two categories you can rank in</li><li>Physical proof copy — approve nothing on screen alone</li></ol><h2>Launch (4 weeks)</h2><ol><li>Launch team recruited and onboarded (advance copies four weeks out)</li><li>Preorder window if your strategy uses one</li><li>Launch-week pricing decided in advance</li><li>Newsletter announcement drafted and scheduled</li><li>Week-one review push, thank-yous, and then: start the next book</li></ol><p>None of these steps is hard. The craft is doing them <em>in order</em> — every horror story you've heard is a step done early, late, or never.</p>",
      status: "PUBLISHED",
      publishedAt: "2026-06-09T09:00:00Z",
      categoryIds: ["seed-postcat-publishing"],
      tags: ["checklist", "self-publishing", "launch"],
    },
  ];

  for (const p of posts) {
    const data = {
      slug: p.slug,
      title: p.title,
      excerpt: p.excerpt,
      content: p.content,
      coverImageUrl: `https://picsum.photos/seed/${p.id}/1200/630`,
      status: p.status,
      publishedAt: p.publishedAt ? new Date(p.publishedAt) : null,
      authorId: adminId,
      tags: p.tags,
    };
    await prisma.post.upsert({
      where: { id: p.id },
      update: { ...data, categories: { set: p.categoryIds.map((id) => ({ id })) } },
      create: {
        id: p.id,
        ...data,
        categories: { connect: p.categoryIds.map((id) => ({ id })) },
      },
    });
  }
}

// ---------- forms ----------

async function seedForms() {
  const contactFields = [
    {
      id: "f-name",
      type: "text",
      label: "Your name",
      name: "name",
      required: true,
      placeholder: "Jane Author",
      mergeTag: "FNAME",
    },
    {
      id: "f-email",
      type: "email",
      label: "Email",
      name: "email",
      required: true,
      placeholder: "you@email.com",
      mergeTag: "EMAIL",
    },
    {
      id: "f-topic",
      type: "select",
      label: "What's this about?",
      name: "topic",
      required: false,
      options: ["Classes & membership", "Coaching", "Something else"],
    },
    {
      id: "f-message",
      type: "textarea",
      label: "How can we help?",
      name: "message",
      required: true,
      placeholder: "Tell us about your book…",
    },
  ] as Prisma.InputJsonValue;
  await prisma.form.upsert({
    where: { id: "seed-form-contact" },
    update: {
      name: "Contact us",
      fields: contactFields,
      status: "ACTIVE",
      successMessage:
        "Thanks — we read every message and reply within two business days.",
    },
    create: {
      id: "seed-form-contact",
      name: "Contact us",
      fields: contactFields,
      status: "ACTIVE",
      successMessage:
        "Thanks — we read every message and reply within two business days.",
    },
  });

  const newsletterFields = [
    {
      id: "f-email",
      type: "email",
      label: "Email",
      name: "email",
      required: true,
      placeholder: "you@email.com",
      mergeTag: "EMAIL",
    },
  ] as Prisma.InputJsonValue;
  await prisma.form.upsert({
    where: { id: "seed-form-newsletter" },
    update: {
      name: "The Author's Notebook (newsletter)",
      fields: newsletterFields,
      status: "ACTIVE",
      tags: ["newsletter"],
      successMessage: "Welcome aboard — check your inbox.",
    },
    create: {
      id: "seed-form-newsletter",
      name: "The Author's Notebook (newsletter)",
      fields: newsletterFields,
      status: "ACTIVE",
      tags: ["newsletter"],
      successMessage: "Welcome aboard — check your inbox.",
    },
  });
}

// ---------- pages (Puck) ----------
// Slot children (Section/Columns) are stored INLINE in props.content; every
// block — nested ones included — carries a unique props.id. zones stays {}.

function aboutPageDoc(): Prisma.InputJsonValue {
  return {
    root: {
      props: {
        seoTitle: "About Unlocking Your Book",
        description:
          "Author coaching, classes and community that take your book from first idea to published.",
        ogImage: cover("about-og"),
      },
    },
    content: [
      {
        type: "Hero",
        props: {
          id: "about-hero",
          eyebrow: "Unlocking Your Book",
          title: "Every writer has a book. We help you finish yours.",
          subtitle:
            "Classes, coaching and a community of working writers — from the first spark of an idea to the day your book goes live.",
          buttonLabel: "Explore the classes",
          buttonHref: "/pricing/all",
          align: "center",
          background: "brand",
          backgroundColor: "",
        },
      },
      {
        type: "Stats",
        props: {
          id: "about-stats",
          columns: "3",
          items: [
            { value: "1,200+", label: "Writers coached" },
            { value: "94", label: "Books published by members" },
            { value: "12 years", label: "Teaching the craft" },
          ],
          design: { paddingY: 32 },
        },
      },
      {
        type: "Heading",
        props: { id: "about-story-h", text: "Why we exist", level: "2", align: "center" },
      },
      {
        type: "RichText",
        props: {
          id: "about-story",
          html: "<p>Most books die in a drawer — not because the writer lacked talent, but because nobody showed them the road. Unlocking Your Book exists to be that road: practical classes taught by working authors, a method that respects your real life, and a community that won't let you quit quietly.</p><p>We don't sell magic. We teach the unglamorous skills that finish books: premise before prose, scenes before sentences, structure before polish — and a publishing path chosen with a spreadsheet instead of a dream.</p>",
          align: "center",
        },
      },
      {
        type: "IconList",
        props: {
          id: "about-promises",
          icon: "check",
          columns: "2",
          iconColor: "",
          items: [
            { text: "Short lessons designed for busy lives" },
            { text: "Real feedback from working authors" },
            { text: "A clear path from idea to published" },
            { text: "Web and mobile — your progress everywhere" },
            { text: "No gatekeeping, no gurus, no fluff" },
            { text: "Cancel anytime; keep what you learned" },
          ],
          design: { paddingY: 24 },
        },
      },
      {
        type: "Cards",
        props: {
          id: "about-pillars",
          columns: "3",
          items: [
            {
              title: "Write",
              text: "Foundations, storytelling and memoir classes that get words on pages.",
              imageUrl: thumb("about-write"),
              href: "/classes/book-writing-foundations",
            },
            {
              title: "Polish",
              text: "Editing bootcamps that turn a messy draft into a manuscript.",
              imageUrl: thumb("about-polish"),
              href: "/classes/editing-revision-bootcamp",
            },
            {
              title: "Publish",
              text: "Production, launch and marketing — your book in readers' hands.",
              imageUrl: thumb("about-publish"),
              href: "/classes/self-publishing-pro",
            },
          ],
        },
      },
      {
        type: "Testimonial",
        props: {
          id: "about-quote",
          quote:
            "I'd been 'writing a book' for six years. Eleven months after joining, I held it in my hands. The difference wasn't motivation — it was finally having a map.",
          author: "Priya N.",
          role: "Author of “The Long Way Home”",
          avatarUrl: avatarImg("priya"),
          design: { background: "#faf5ef", radius: 16, paddingY: 24, paddingX: 24 },
        },
      },
      {
        type: "FAQ",
        props: {
          id: "about-faq",
          items: [
            {
              question: "I've never written anything. Can I start here?",
              answer:
                "Yes — Book Writing Foundations is free for every member and assumes nothing but the itch to write.",
            },
            {
              question: "How much time do I need each week?",
              answer:
                "Lessons run 5–12 minutes, and the method is built around a daily minimum small enough to survive a busy life. Most members invest 2–3 hours a week.",
            },
            {
              question: "Do you cover self-publishing AND traditional?",
              answer:
                "Both, without tribalism. Self-Publishing Pro covers the full indie path; the same class teaches you to evaluate traditional and hybrid offers with clear eyes.",
            },
            {
              question: "Can I cancel anytime?",
              answer:
                "Anytime, from your account page, in two clicks. You keep access until the end of the period you've paid for.",
            },
          ],
        },
      },
      {
        type: "CTA",
        props: {
          id: "about-cta",
          title: "Your book is waiting.",
          subtitle: "Start free with Book Writing Foundations — today's the day.",
          buttonLabel: "Start writing",
          buttonHref: "/classes/book-writing-foundations",
          background: "dark",
          backgroundColor: "",
          align: "center",
        },
      },
    ],
    zones: {},
  };
}

function startHerePageDoc(): Prisma.InputJsonValue {
  return {
    root: {
      props: {
        seoTitle: "Start Here — Unlocking Your Book",
        description: "New to Unlocking Your Book? Here's your first week, mapped.",
        ogImage: "",
      },
    },
    content: [
      {
        type: "Hero",
        props: {
          id: "sh-hero",
          eyebrow: "Welcome",
          title: "Start here",
          subtitle:
            "Five minutes of orientation, then straight into the work. Here's exactly what to do first.",
          buttonLabel: "Go to my dashboard",
          buttonHref: "/dashboard",
          align: "center",
          background: "muted",
          backgroundColor: "",
        },
      },
      {
        type: "Section",
        props: {
          id: "sh-week1",
          background: "muted",
          backgroundColor: "",
          paddingY: 56,
          maxWidth: "normal",
          content: [
            {
              type: "Heading",
              props: { id: "sh-week1-h", text: "Your first week", level: "2", align: "left" },
            },
            {
              type: "RichText",
              props: {
                id: "sh-week1-t",
                html: "<p>Don't binge — build. The members who finish books all start the same way:</p>",
                align: "left",
              },
            },
            {
              type: "IconList",
              props: {
                id: "sh-week1-list",
                icon: "arrow",
                columns: "1",
                iconColor: "",
                items: [
                  { text: "Day 1: Watch the first two Foundations lessons (13 minutes)" },
                  { text: "Day 2: Write your one-sentence premise and pin it above your desk" },
                  { text: "Day 3–4: Build your 12-beat outline with the lesson worksheet" },
                  { text: "Day 5: Set your daily minimum and book your writing appointment" },
                  { text: "Weekend: Write your first 200 words. That's the whole assignment." },
                ],
              },
            },
          ],
        },
      },
      {
        type: "Columns",
        props: {
          id: "sh-paths",
          columns: "2",
          gap: 24,
          content: [
            {
              type: "RichText",
              props: {
                id: "sh-path-new",
                html: "<h3>New to writing?</h3><p>Start with <strong>Book Writing Foundations</strong> — it's free with your membership and walks you from idea to outline to a habit that sticks. Everything else builds on it.</p>",
                align: "left",
              },
            },
            {
              type: "RichText",
              props: {
                id: "sh-path-draft",
                html: "<h3>Already have a draft?</h3><p>Jump into the <strong>Editing & Revision Bootcamp</strong> to whip it into shape, or <strong>Self-Publishing Pro</strong> if your manuscript is ready for the world.</p>",
                align: "left",
              },
            },
          ],
        },
      },
      {
        type: "Divider",
        props: { id: "sh-div", width: "narrow", thickness: 1, style: "solid", color: "" },
      },
      {
        type: "CTA",
        props: {
          id: "sh-cta",
          title: "Questions before you dive in?",
          subtitle: "We read every message and reply within two business days.",
          buttonLabel: "Contact us",
          buttonHref: "/contact",
          background: "muted",
          backgroundColor: "",
          align: "center",
        },
      },
    ],
    zones: {},
  };
}

function contactPageDoc(): Prisma.InputJsonValue {
  return {
    root: {
      props: {
        seoTitle: "Contact — Unlocking Your Book",
        description: "Questions about classes, coaching or your membership? Write to us.",
        ogImage: "",
      },
    },
    content: [
      {
        type: "Heading",
        props: { id: "ct-h", text: "Get in touch", level: "1", align: "center" },
      },
      {
        type: "RichText",
        props: {
          id: "ct-intro",
          html: "<p>Questions about a class, your membership, or whether your book idea has legs? Send a note — a real person (usually the person who taught your last lesson) reads every message, and we reply within two business days.</p>",
          align: "center",
        },
      },
      { type: "Form", props: { id: "ct-form", formId: "seed-form-contact" } },
      {
        type: "Divider",
        props: { id: "ct-div", width: "narrow", thickness: 1, style: "solid", color: "" },
      },
      {
        type: "RichText",
        props: {
          id: "ct-alt",
          html: "<p>Prefer email? Write to <a href=\"mailto:hello@unlockingyourbook.com\">hello@unlockingyourbook.com</a>.</p>",
          align: "center",
        },
      },
    ],
    zones: {},
  };
}

async function seedPages(adminId: string) {
  const pages: Array<{
    id: string;
    slug: string;
    title: string;
    status: "PUBLISHED" | "DRAFT";
    publishedAt: string | null;
    data: Prisma.InputJsonValue;
  }> = [
    {
      id: "seed-page-about", // id is load-bearing (popups.feature INCLUDE target)
      slug: "about",
      title: "About Us",
      status: "PUBLISHED",
      publishedAt: "2026-05-20T09:00:00Z",
      data: aboutPageDoc(),
    },
    {
      id: "seed-page-start-here",
      slug: "start-here",
      title: "Start Here",
      status: "PUBLISHED",
      publishedAt: "2026-05-21T09:00:00Z",
      data: startHerePageDoc(),
    },
    {
      id: "seed-page-contact",
      slug: "contact",
      title: "Contact",
      status: "PUBLISHED",
      publishedAt: "2026-05-21T10:00:00Z",
      data: contactPageDoc(),
    },
    {
      id: "seed-page-draft", // slug asserted DRAFT/404 by pages.feature
      slug: "coming-soon",
      title: "Coming soon",
      status: "DRAFT",
      publishedAt: null,
      data: {
        root: { props: { description: "" } },
        content: [
          {
            type: "Heading",
            props: { id: "cs-h", text: "Coming soon", level: "1", align: "center" },
          },
        ],
        zones: {},
      } as Prisma.InputJsonValue,
    },
  ];
  for (const p of pages) {
    const data = {
      slug: p.slug,
      title: p.title,
      status: p.status,
      publishedAt: p.publishedAt ? new Date(p.publishedAt) : null,
      authorId: adminId,
      data: p.data,
    };
    await prisma.page.upsert({
      where: { id: p.id },
      update: data,
      create: { id: p.id, ...data },
    });
  }
}

// ---------- popups ----------

async function seedPopups() {
  // Welcome popup: dashboard only, 2s after load, once per session.
  const welcome = {
    name: "Welcome to Unlocking Your Book",
    status: "ACTIVE" as const,
    position: "CENTER" as const,
    width: "480px",
    height: "auto",
    background: "#ffffff",
    borderColor: "#e7e5e4",
    borderRadius: 16,
    padding: 28,
    showOnDashboard: true,
    showOnClasses: false,
    showOnCourses: false,
    showOnLessons: false,
    pageMode: "NONE" as const,
    pageIds: [] as string[],
    trigger: "DELAY" as const,
    triggerValue: 2,
    frequency: "ONCE_PER_SESSION" as const,
    frequencyDays: 7,
    closeOnOverlay: true,
    animation: "FADE" as const,
    data: {
      root: { props: {} },
      content: [
        {
          type: "Heading",
          props: { id: "wp-h", text: "Welcome back, writer ✍️", level: "2", align: "center" },
        },
        {
          type: "RichText",
          props: {
            id: "wp-t",
            html: "<p>Your book moves forward one session at a time — and the next one is right here. New to the community? The Start Here page maps your first week.</p>",
            align: "center",
          },
        },
        {
          type: "Button",
          props: {
            id: "wp-b",
            label: "See how to start",
            href: "/start-here",
            variant: "primary",
            align: "center",
            newTab: false,
          },
        },
      ],
      zones: {},
    } as Prisma.InputJsonValue,
  };
  await prisma.popup.upsert({
    where: { id: "seed-popup-welcome" },
    update: welcome,
    create: { id: "seed-popup-welcome", ...welcome },
  });

  // Promo popup: class landing pages, fires at 40% scroll, max once / 3 days.
  const promo = {
    name: "Finish-your-book promo",
    status: "ACTIVE" as const,
    position: "BOTTOM_RIGHT" as const,
    width: "400px",
    height: "auto",
    background: "#1c1917",
    borderColor: "#44403c",
    borderRadius: 14,
    padding: 24,
    showOnDashboard: false,
    showOnClasses: true,
    showOnCourses: false,
    showOnLessons: false,
    pageMode: "NONE" as const,
    pageIds: [] as string[],
    trigger: "SCROLL" as const,
    triggerValue: 40,
    frequency: "ONCE_PER_DAYS" as const,
    frequencyDays: 3,
    closeOnOverlay: true,
    animation: "SLIDE_UP" as const,
    data: {
      root: { props: {} },
      content: [
        {
          type: "Heading",
          props: {
            id: "pp-h",
            text: "This is the year your book ships",
            level: "3",
            align: "left",
            design: { textColor: "#fafaf9" },
          },
        },
        {
          type: "RichText",
          props: {
            id: "pp-t",
            html: "<p>Self-Publishing Pro now has a 6-payment plan — finish paying, keep it for life.</p>",
            align: "left",
            design: { textColor: "#d6d3d1" },
          },
        },
        {
          type: "Button",
          props: {
            id: "pp-b",
            label: "See the plan",
            href: "/checkout/self-publishing-pro",
            variant: "primary",
            align: "left",
            newTab: false,
          },
        },
      ],
      zones: {},
    } as Prisma.InputJsonValue,
  };
  await prisma.popup.upsert({
    where: { id: "seed-popup-classes-promo" },
    update: promo,
    create: { id: "seed-popup-classes-promo", ...promo },
  });
}

// ---------- navigation: menus, header, footer ----------

async function seedNav() {
  await prisma.menu.upsert({
    where: { id: "seed-menu-header" },
    update: { name: "Main navigation", location: "HEADER" },
    create: { id: "seed-menu-header", name: "Main navigation", location: "HEADER" },
  });
  await prisma.menu.upsert({
    where: { id: "seed-menu-footer" },
    update: { name: "Footer links", location: "FOOTER" },
    create: { id: "seed-menu-footer", name: "Footer links", location: "FOOTER" },
  });

  type ItemSeed = {
    id: string;
    menuId: string;
    order: number;
    label: string;
    type:
      | "PAGE"
      | "CLASS"
      | "CLASS_INDEX"
      | "COURSE"
      | "COURSE_INDEX"
      | "BLOG_INDEX"
      | "BLOG_POST"
      | "ROUTE"
      | "CUSTOM";
    url?: string;
    pageId?: string;
    visibility?: "ALL" | "GUEST" | "AUTHED" | "LEVEL";
  };
  const items: ItemSeed[] = [
    { id: "seed-mi-h-classes", menuId: "seed-menu-header", order: 0, label: "Classes", type: "CLASS_INDEX" },
    { id: "seed-mi-h-start", menuId: "seed-menu-header", order: 1, label: "Start Here", type: "PAGE", pageId: "seed-page-start-here" },
    { id: "seed-mi-h-blog", menuId: "seed-menu-header", order: 2, label: "Blog", type: "BLOG_INDEX" },
    { id: "seed-mi-h-about", menuId: "seed-menu-header", order: 3, label: "About", type: "PAGE", pageId: "seed-page-about" },
    { id: "seed-mi-h-contact", menuId: "seed-menu-header", order: 4, label: "Contact", type: "PAGE", pageId: "seed-page-contact" },
    { id: "seed-mi-f-about", menuId: "seed-menu-footer", order: 0, label: "About", type: "PAGE", pageId: "seed-page-about" },
    { id: "seed-mi-f-blog", menuId: "seed-menu-footer", order: 1, label: "Blog", type: "BLOG_INDEX" },
    { id: "seed-mi-f-contact", menuId: "seed-menu-footer", order: 2, label: "Contact", type: "PAGE", pageId: "seed-page-contact" },
    { id: "seed-mi-f-dashboard", menuId: "seed-menu-footer", order: 3, label: "My Dashboard", type: "ROUTE", url: "/dashboard", visibility: "AUTHED" },
  ];
  for (const it of items) {
    const data = {
      menuId: it.menuId,
      order: it.order,
      label: it.label,
      type: it.type,
      url: it.url ?? null,
      pageId: it.pageId ?? null,
      visibility: it.visibility ?? ("ALL" as const),
    };
    await prisma.menuItem.upsert({
      where: { id: it.id },
      update: data,
      create: { id: it.id, ...data },
    });
  }

  // Site header (shapes per apps/api/src/site/site.service.ts sanitizers).
  const headerConfig = {
    layout: "THREE_COL",
    width: "BOXED",
    maxWidth: 1080,
    bgColor: "#ffffff",
    paddingX: 24,
    paddingY: 10,
    logoUrl: null,
    menuId: "seed-menu-header",
    linkColor: "#44403c",
    menuActiveColor: "#b45309",
    ctas: [
      {
        id: "cta-join",
        label: "Join a class",
        bgColor: "#b45309",
        textColor: "#ffffff",
        paddingX: 16,
        paddingY: 8,
        borderRadius: 8,
        link: { type: "CLASS_INDEX" },
      },
    ],
  } as Prisma.InputJsonValue;
  const headerConditions = {
    audience: "ALL",
    audienceLevelId: null,
    pageMode: "ALL",
    includePageIds: [],
    includeSections: [],
    excludePageIds: [],
    excludeSections: [],
  } as Prisma.InputJsonValue;
  await prisma.header.upsert({
    where: { id: "seed-header-main" },
    update: { name: "Main header", config: headerConfig, conditions: headerConditions, priority: 10, enabled: true },
    create: {
      id: "seed-header-main",
      name: "Main header",
      config: headerConfig,
      conditions: headerConditions,
      priority: 10,
      enabled: true,
    },
  });

  // Footer singleton (shape per apps/api/src/site/footer.service.ts).
  const footerConfig = {
    enabled: true,
    bgColor: "#1c1917",
    textColor: "#d6d3d1",
    headingColor: "#ffffff",
    linkColor: "#e7e5e4",
    paddingY: 48,
    logoUrl: null,
    tagline: "Write it. Publish it. Share it.",
    menuHeading: "Explore",
    menuId: "seed-menu-footer",
    email: {
      heading: "The Author's Notebook",
      text: "One craft lesson and one publishing tip, every Tuesday.",
      placeholder: "you@email.com",
      buttonText: "Subscribe",
      audienceId: null,
      audienceName: null,
      doubleOptIn: false,
      successMessage: "Welcome aboard — check your inbox.",
    },
    copyright: "© {year} Unlocking Your Book. All rights reserved.",
    bottomLinks: [
      { id: "bl-about", label: "About", url: "/about" },
      { id: "bl-contact", label: "Contact", url: "/contact" },
    ],
  } as Prisma.InputJsonValue;
  await prisma.footer.upsert({
    where: { id: "singleton" },
    update: { config: footerConfig },
    create: { id: "singleton", config: footerConfig },
  });
}

// ---------- app customization (mobile branding) ----------

async function seedAppConfig() {
  // Cross-stack palette defaults with a literary amber primary:
  // light #b45309 on white ≈ 4.8:1, dark #f59e0b on #0b0b0d ≈ 10:1.
  const config = {
    title: "Unlocking Your Book",
    tagline: "Write it. Publish it. Share it.",
    description:
      "Author coaching, classes and community that take your book from first idea to published.",
    logoUrl: null,
    iconUrl: null,
    splashUrl: null,
    colorScheme: "system",
    light: {
      bg: "#f6f7f9",
      surface: "#ffffff",
      surfaceMuted: "#eef0f4",
      border: "#e4e7ec",
      text: "#101828",
      textMuted: "#667085",
      primary: "#b45309",
      danger: "#d92d20",
    },
    dark: {
      bg: "#0b0b0d",
      surface: "#16161b",
      surfaceMuted: "#1c1c22",
      border: "#2d2d32",
      text: "#f4f4f6",
      textMuted: "#8a8a95",
      primary: "#f59e0b",
      danger: "#ef4444",
    },
  } as Prisma.InputJsonValue;
  // Singleton: drop any stray rows, keep exactly one.
  await prisma.appConfig.deleteMany({ where: { id: { not: "singleton" } } });
  await prisma.appConfig.upsert({
    where: { id: "singleton" },
    update: { config },
    create: { id: "singleton", config },
  });
}

// ---------- main ----------

async function main() {
  if (WIPE) {
    await wipeDatabase();
    wipeUploadDirs();
  }

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

  const { memberId } = await seedFixtureCluster();
  await seedCatalog();
  await seedForms();
  await seedBlog(admin.id);
  await seedPages(admin.id);
  await seedPopups();
  await seedNav();
  await seedAppConfig();
  await seedMemberState(memberId);

  const counts = {
    classes: CLASSES.length,
    courses: CLASSES.reduce((n, c) => n + c.courses.length, 0),
    lessons: CLASSES.reduce(
      (n, c) => n + c.courses.reduce((m, co) => m + co.lessons.length, 0),
      0,
    ),
  };
  console.log("Seed complete — Unlocking Your Book demo content.");
  console.log(`  Admin:   admin@example.com / ${adminPassword}`);
  console.log(
    "  Member:  member@example.com / member123 (enrolled in Foundations + Memoir)",
  );
  console.log(
    `  Catalog: ${counts.classes} classes · ${counts.courses} courses · ${counts.lessons} lessons (+ QA fixtures)`,
  );
  console.log("  Blog:    7 published posts + 1 draft · 5 categories");
  console.log("  Pages:   /about · /start-here · /contact (+ coming-soon draft)");
  console.log("  Popups:  welcome (dashboard) + promo (class pages)");
  console.log("  Nav:     header menu + CTA · footer with newsletter");
  console.log("  App:     'Unlocking Your Book' branding (amber primary)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
