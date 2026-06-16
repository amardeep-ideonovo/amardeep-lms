// Dev/demo seed — "Spotlight Academy", a MasterClass-style entertainment
// catalog (music, food, photography, dance, film, comedy). Idempotent (fixed
// ids + upserts with FULL update payloads, so a plain re-run restores every
// seeded row to spec; admin edits to seeded rows are intentionally reverted).
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
// Class/course cover art hotlinks masterclass.com course images (public CDN
// paths, verified to serve without auth/referer) — dev/demo use only.
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

// Public sample videos. The Vimeo clip is the user-chosen free video; two
// Google sample MP4s stay in rotation so both player paths (Vimeo embed and
// native <video>/expo-video) keep demo coverage.
const FREE_VIMEO = "https://vimeo.com/1189998581";
const VIDEOS = [
  FREE_VIMEO,
  FREE_VIMEO,
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
  FREE_VIMEO,
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
];
const TRAILER = FREE_VIMEO; // class trailers render in the web Vimeo embed

// MasterClass course-image CDN (public, unsigned). Grouped per theme so each
// class's covers/courses rotate through on-theme art.
const MC = "https://www.masterclass.com/course-images/attachments";
const ART: Record<string, string[]> = {
  music: [
    `${MC}/QpxuNEFhJE8MsFqsiKQ11u1C`, // songwriting & creativity
    `${MC}/TXdwv2Ztz1wa8C83dCVCRf72`, // songwriting & producing
    `${MC}/jwzsuraseau3qbmcx13dxs4ewgsg`, // the voice as an instrument
    `${MC}/jybjfjy5f2tadf5s6lrl5v8j3gv7`, // songwriting
    `${MC}/wjzyWzh7DvbAZyVmVyiRTLQ7`, // singing
  ],
  food: [
    `${MC}/ce3SwsNJRtiLU96MqFEfa3WU`, // cooking I
    `${MC}/M9gAFDV18n8Z1ULC54QB8YXH`,
    `${MC}/YPStdCGCyV5658a5zcWUJGf9`,
    `${MC}/2qogs1ilsevi3s8geruqx3jcp2mt`, // modern vegetarian
    `${MC}/ytDCxGh9USkRaFbphiuAdszK`, // bread baking
    `${MC}/59o1zn2bn6d0pyk1h9jmlfrr15h6`, // southern cooking
  ],
  photo: [
    `${MC}/DHTYrpiQ7QJediHA387veDhg`, // photography
    `${MC}/ycGSPAPHkfDjBQcGtRDcMyo5`,
    `${MC}/e2G987xiZ8vHPcotZ994k2bm`,
    `${MC}/wsyt1jeo5j0k1xgoa1cqir6qjrse`,
  ],
  dance: [
    `${MC}/XkV5JF4hBKEMwamsMaiuDj4f`, // ballet technique
    `${MC}/JSnpNqo1BusYpZwAWp3HyWiw`,
    `${MC}/beRishN5NrJ9mx2fNiJXjtWi`, // choreography
    `${MC}/t2SrkYWHnLATBozjaXs78g3W`,
    `${MC}/Ld1sTjJLfL2BTuq9gpoirRRB`,
  ],
  film: [
    `${MC}/2DMQb6ABKGnNhenm9cznKPGP`, // filmmaking
    `${MC}/gsaVP3JmiRSuzvLcWaLF5cfB`, // independent filmmaking
    `${MC}/nvZw5QgUPta9GANg8MFV6bxs`,
    `${MC}/K42EgdcRWTFa8ifP1go8BDoQ`, // directing
    `${MC}/kQwuneEoWaodkAEAcQDXsmSg`,
    `${MC}/mQXVmmeUxifyBWPAUavGtVCT`, // documentary
  ],
  comedy: [
    `${MC}/RvoH3zg9Ao1JfaGkdXymf1UM`, // comedy
    `${MC}/rfwmdniWpGRpCRDjG9sf58QZ`,
    `${MC}/sl76691dyobvrq3p1kvsv6ip7xfr`,
  ],
};
const art = (theme: string, i: number) => {
  const set = ART[theme] ?? ART.film;
  return set[i % set.length];
};

// Deterministic fillers (picsum) for skills/avatars/blog covers.
const thumb = (key: string) => `https://picsum.photos/seed/${key}-thumb/600/600`;
const lessonThumb = (key: string) =>
  `https://picsum.photos/seed/${key}-lt/640/400`;
const skillImg = (key: string) => `https://picsum.photos/seed/${key}-sk/400/300`;
const avatarImg = (key: string) => `https://picsum.photos/seed/${key}-av/200/200`;
const cover = (key: string) => `https://picsum.photos/seed/${key}-cover/1200/630`;

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
    prisma.certificate.deleteMany(), // before User/Level (FKs)
    prisma.certificateTemplate.deleteMany(), // before Level (Level.certificateTemplateId is SetNull, but be tidy)
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
    process.env.CERT_FILES_DIR || path.join(apiSrc, "files", "certificates"),
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
      audienceTags: ["free"],
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
      audienceTags: ["pro"],
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
      videoUrl: FREE_VIMEO,
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
      audienceTags: [],
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
  theme: string; // ART image set
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
    key: "music",
    theme: "music",
    name: "Music Production & Songwriting",
    slug: "music-production-songwriting",
    type: "FREE",
    description:
      "Write songs people remember and produce them from your bedroom. Melody, lyrics, structure and a home-studio workflow that turns ideas into finished tracks — free for every member.",
    categories: ["seed-lvlcat-music"],
    skills: [
      "Turn a hum into a hook",
      "Write lyrics that say something",
      "Arrange a song that builds",
      "Record clean takes at home",
      "Mix to a release-ready rough",
    ],
    prices: [],
    courses: [
      {
        key: "music-1",
        title: "Songwriting Fundamentals",
        description:
          "Hooks, lyrics and song structure — the craft behind every track you can't stop humming.",
        lessons: [
          L(
            "Start with the hook",
            7,
            20,
            paras(
              "Almost every great song is built around one irresistible moment — a melodic phrase, a lyric, a rhythm that your ear wants again. Professional writers don't wait for that moment; they hunt it deliberately.",
              "In this lesson you'll capture twenty tiny ideas in twenty minutes: hum into your phone, tap rhythms on the table, sing nonsense syllables over two chords. Quantity is the strategy — taste comes later, at the listening pass.",
              "Then we pick ONE idea and loop it until it tells us what it wants to be. A hook isn't precious; it's a seed you water with repetition.",
            ),
          ),
          L(
            "Lyrics: say one true thing",
            9,
            10,
            paras(
              "Weak lyrics try to say everything; strong lyrics say one true thing from a specific place. 'I miss you' is a greeting card — 'your coffee cup is still in the sink' is a song.",
              "We'll practice the object exercise: pick a feeling, then write only about physical things — rooms, weather, receipts, shoes. The feeling sneaks in through the details, which is exactly how listeners like to receive it.",
              "You'll finish with a verse built from your own object list, plus the one-line test: can you say what the song is about in seven words? If not, it's two songs fighting.",
            ),
          ),
          L(
            "Song structure that builds",
            10,
            45,
            paras(
              "Verse, pre-chorus, chorus, bridge — structure isn't a formula, it's energy management. Each section's job is to make the next one feel inevitable.",
              "We'll map three hit songs bar by bar and watch the pattern: every eight bars something changes — a new instrument, a lifted melody, a dropped drum. Boredom is the only real rule violation.",
              "Then you'll storyboard your own song's energy on paper before recording a note: where it whispers, where it opens up, and what gets saved for the final chorus.",
            ),
          ),
        ],
      },
      {
        key: "music-2",
        title: "Home Studio Production",
        description:
          "From a quiet room to a finished track: recording, arranging and the rough mix.",
        lessons: [
          L(
            "Your room is your first instrument",
            8,
            30,
            paras(
              "Before you buy gear, treat the room. A duvet behind the mic kills more problems than a thousand-dollar preamp. We'll find your room's quietest corner and build a vocal nook with what you own.",
              "Gear order for a first studio: a decent USB or budget XLR mic, closed headphones, then — only when something specific hurts — an interface upgrade. Every purchase should fix a problem you can name.",
              "You'll record the same eight bars three ways tonight and hear exactly what placement changes. Trust your ears over the spec sheet.",
            ),
          ),
          L(
            "Arranging in the box",
            11,
            15,
            paras(
              "An arrangement is a conversation: every part either talks, answers, or shuts up. The number-one amateur tell is everything playing all the time.",
              "We'll build a track in layers — drums and bass agree first, chords sit in the middle, and anything new must either replace something or wait its turn. The mute button is your best arranger.",
              "Listen in mono while you work. If parts disappear, they were fighting; carve space by octave, rhythm or simply deleting the weakest idea.",
            ),
          ),
          L(
            "The rough mix that travels",
            9,
            40,
            paras(
              "A rough mix has one job: sound good everywhere — phone speaker, car, earbuds. We chase balance, not polish: vocals you can always hear, a kick you can always feel, nothing that makes you reach for the volume.",
              "The workflow: set levels with faders only, pan for width, ONE EQ move per channel (cut, don't boost), a touch of bus compression, and a reference track you A/B every ten minutes.",
              "Bounce it, play it on three devices, write down what bugs you, fix the top item only. Mixing is a loop, not a destination — and done beats perfect on a demo.",
            ),
          ),
        ],
      },
    ],
  },
  {
    key: "cooking",
    theme: "food",
    name: "The Art of Cooking",
    slug: "the-art-of-cooking",
    type: "PAID",
    description:
      "Cook with confidence instead of recipes. Knife skills, heat control, seasoning by taste and the flavor instincts that turn whatever's in the fridge into dinner people talk about.",
    categories: ["seed-lvlcat-food"],
    skills: [
      "Knife skills that feel automatic",
      "Control heat instead of fearing it",
      "Season by taste, not by teaspoon",
      "Build flavor in layers",
      "Plate food people photograph",
      "Host without losing your evening",
    ],
    prices: [
      { interval: "month", amount: 2900 },
      { interval: "year", amount: 29000 },
    ],
    courses: [
      {
        key: "cooking-1",
        title: "Kitchen Foundations",
        description:
          "The unglamorous skills that make everything else easy: knives, heat and salt.",
        lessons: [
          L(
            "Knife skills: speed comes last",
            9,
            25,
            paras(
              "Every cooking show makes speed look like the goal. It isn't — consistency is. Same-size pieces cook at the same rate, and that single fact is most of what separates home food from restaurant food.",
              "We'll set your grip (pinch the blade, not the handle), your guide hand (claw, knuckles forward) and your board setup (damp towel underneath, scraps bowl beside). Then: onions three ways, slowly.",
              "Ten slow minutes a day for two weeks beats one ambitious Sunday. Speed arrives on its own, as a side effect of repetition — never chase it.",
            ),
          ),
          L(
            "Heat is a language",
            10,
            50,
            paras(
              "Most home cooking fails at the dial: too timid to sear, too impatient to sweat. Pans talk — the sizzle pitch, the smell, the way oil moves — and this lesson teaches you to listen.",
              "We'll cook the same chicken thigh at three heats and taste the difference between steamed-in-its-own-juices, properly seared, and scorched. You'll learn the hand-hover test and when to simply walk away from the pan.",
              "The rule that changes everything: get the pan ready before the food, and stop cooking things one minute before they look done. Carryover heat finishes the job.",
            ),
          ),
          L(
            "Salt, fat, acid: season by taste",
            8,
            35,
            paras(
              "Recipes give you teaspoons; cooks taste. Salt opens flavor, fat carries it, acid wakes it up — and the only way to learn the triangle is on your tongue.",
              "We'll run the carrot-soup experiment: one pot, four bowls, four adjustments. You'll taste exactly what 'needs salt', 'needs acid' and 'needs richness' mean, and you'll never un-taste it.",
              "From today: taste at every stage, season in small layers, and finish with something bright. Your food will improve before your knife skills do.",
            ),
          ),
        ],
      },
      {
        key: "cooking-2",
        title: "Mastering Flavor",
        description: "Layering, balancing and rescuing — how flavor actually gets built.",
        lessons: [
          L(
            "Build flavor in layers",
            11,
            5,
            paras(
              "Deep flavor isn't one ingredient — it's a stack of small decisions: brown the aromatics, toast the spices, deglaze the pan, reduce, finish with fresh herbs. Each layer is thirty seconds of intention.",
              "We'll build the same tomato sauce twice — dump-and-simmer versus layered — and taste them side by side. The difference will feel illegal.",
              "You'll leave with the universal layering map (aromatics → spice → main → liquid → reduce → finish) that works for curries, ragùs, braises and beans alike.",
            ),
          ),
          L(
            "Fix it: too salty, too flat, too much",
            7,
            55,
            paras(
              "Great cooks aren't people who never miss — they're people who can rescue. Too salty wants dilution, starch or dairy. Flat wants acid or salt. Bitter wants fat and a pinch of sugar. Greasy wants acid and heat.",
              "We'll deliberately break a pan sauce four ways and repair it four ways, so the fixes live in your hands, not your notes.",
              "The meta-skill: taste, name the problem out loud, change ONE thing, taste again. Panic seasons by the handful; cooks season by the pinch.",
            ),
          ),
        ],
      },
      {
        key: "cooking-3",
        title: "Cooking for People You Love",
        description:
          "Menus, timing and plating — dinner parties without the meltdown.",
        lessons: [
          L(
            "Menu math for hosts",
            8,
            15,
            paras(
              "The secret of relaxed hosts: one dish with drama, everything else humble and make-ahead. Three courses where two are done before the doorbell is a dinner party; three à-la-minute dishes is a hostage situation.",
              "We'll design your house menu — a starter that sits happily, a main with one finishing step, a dessert from the fridge — and write the shopping list backwards from it.",
              "Cook your house menu three times for family before any guests see it. Familiarity is the actual ingredient people call 'effortless'.",
            ),
          ),
          L(
            "The timeline is the recipe",
            9,
            45,
            paras(
              "Food rarely fails at the stove on the night — it fails in the sequencing. We'll write a T-minus timeline: T-1 day (shop, marinate, dessert), T-3 hours (mise en place, table), T-30 (starter out, main staged), T-0 (pour drinks, breathe).",
              "Every dish gets a parking spot: what can hold warm, what holds cold, what genuinely must be last-minute (almost nothing).",
              "You'll also plan the host's golden rule: be IN the room. A slightly-too-simple menu served by a present, laughing host beats a tasting menu served by a ghost.",
            ),
          ),
          L(
            "Plating: the thirty-second upgrade",
            6,
            50,
            paras(
              "We eat with our eyes first, and plating is cheaper than truffles. Warm plates, odd numbers, height over sprawl, sauce under not over, and one element of contrast — crunch, color or fresh green.",
              "We'll plate the same stew three ways — straight from the pot, family-style with intention, and restaurant-style — and photograph each. The food never changed; the experience did.",
              "Steal the home-cook's finishing kit: flaky salt, good olive oil, a lemon, soft herbs. Four touches, every plate, thirty seconds.",
            ),
          ),
        ],
      },
    ],
  },
  {
    key: "photo",
    theme: "photo",
    name: "Photography: Seeing the Frame",
    slug: "photography-seeing-the-frame",
    type: "PAID",
    description:
      "Make photographs, not snapshots. Light, composition and a simple manual-mode workflow — then portraits with real presence and an editing style that's recognizably yours.",
    categories: ["seed-lvlcat-photo"],
    skills: [
      "Read light like a photographer",
      "Compose frames that hold attention",
      "Shoot manual without fear",
      "Direct people into natural portraits",
      "Edit with a consistent style",
    ],
    prices: [{ interval: "month", amount: 2400 }],
    courses: [
      {
        key: "photo-1",
        title: "Seeing Light",
        description:
          "Exposure, direction and quality of light — the only subject photography has.",
        lessons: [
          L(
            "Light first, subject second",
            8,
            50,
            paras(
              "Beginners hunt subjects; photographers hunt light. The same doorway is a throwaway at noon and a masterpiece at golden hour — nothing changed but the light.",
              "This week's exercise: photograph ONE boring object — a chair, a mug — ten times in ten different lights. Window light, backlight, lamp light, phone-torch light, dusk.",
              "Reviewing those ten frames teaches more than a month of tutorials: you'll start seeing direction, softness and color temperature everywhere you go.",
            ),
          ),
          L(
            "Manual mode in one afternoon",
            12,
            20,
            paras(
              "The exposure triangle sounds like math until you touch it. Aperture is how much light AND how blurry the background; shutter is how much light AND how frozen the motion; ISO is the volume knob with a noise tax.",
              "We'll run the kitchen-table drill: same scene, one dial at a time, watching what each stop actually does. Twenty minutes of turning knobs beats twenty diagrams.",
              "Your training wheels: aperture priority with auto-ISO capped at 3200. You choose the look, the camera handles the bookkeeping — full manual arrives naturally when you start disagreeing with it.",
            ),
          ),
          L(
            "Composition: guide the eye",
            9,
            35,
            paras(
              "A photograph is an argument about where to look. Thirds, leading lines, frames within frames — these aren't rules, they're tools for steering attention.",
              "We'll practice subtraction: before every shutter press, ask 'what can leave this frame?' Step closer, change angle, wait for the pedestrian to pass. The strongest composition is usually the simplest one you almost took.",
              "Then: edges. Amateurs watch the center; photographers patrol the edges, where poles grow out of heads and half-cars sneak in. Scan the border, then shoot.",
            ),
          ),
        ],
      },
      {
        key: "photo-2",
        title: "Portraits with Presence",
        description: "Directing people, choosing light and getting past the stiff smile.",
        lessons: [
          L(
            "Direct, don't pose",
            10,
            10,
            paras(
              "Nobody relaxes when you say 'act natural'. People relax when they have something to DO. Give actions, not poses: 'walk toward me slowly', 'fix your sleeve', 'look at the window, now back to me'.",
              "We'll build your direction playbook — ten prompts that produce movement, laughter and in-between moments. The frame you want is usually the one between the ones they think you're taking.",
              "Keep talking, keep shooting, show them a good frame early. Confidence is contagious in both directions, and the camera records it.",
            ),
          ),
          L(
            "Window-light portraits",
            8,
            5,
            paras(
              "The best portrait light you own is a window with the sun NOT shining straight through it. Big, soft, directional — studio softboxes spend thousands imitating it.",
              "We'll work the clock: subject at 45° to the window for classic modeling, face-on for beauty light, back-to-window for rim-lit mood. A white wall or foam board is your fill crew.",
              "Watch the eyes — the catchlight is the portrait's pulse. If the eyes are dead, move two steps and try again; if they sparkle, you're done scouting.",
            ),
          ),
        ],
      },
      {
        key: "photo-3",
        title: "Editing & Your Style",
        description: "A fast, repeatable edit — and the taste that makes photos yours.",
        lessons: [
          L(
            "The five-slider edit",
            9,
            0,
            paras(
              "Most photos need five moves: exposure to taste, white balance to honesty, contrast to intention, highlights down, shadows up. Everything else is seasoning.",
              "We'll edit five very different frames with only those sliders and watch them land at 90% finished. The discipline matters: a constrained edit keeps your library coherent and your evenings free.",
              "Edit the day after the shoot, never the same night — and cull ruthlessly first. Editing twelve keepers is craft; editing four hundred frames is punishment.",
            ),
          ),
          L(
            "Finding your look",
            7,
            45,
            paras(
              "Style isn't a preset you buy; it's a pattern in your choices. Collect thirty photographs you love — yours and others' — and write down what repeats. Warm or cool? Clean or grainy? Close or wide? Busy or empty?",
              "That list is your style brief. Edit toward it for a month: same tones, same crop instincts, same subjects. Consistency reads as voice long before mastery does.",
              "Revisit the brief each season. Style is a direction you keep choosing, not a destination you arrive at.",
            ),
          ),
        ],
      },
    ],
  },
  {
    key: "dance",
    theme: "dance",
    name: "Dance & Choreography",
    slug: "dance-and-choreography",
    type: "PAID",
    description:
      "Move with confidence — at any age, in any body. Musicality, grounded technique and the choreographic tools to turn eight counts of nothing into a piece people feel.",
    categories: ["seed-lvlcat-dance"],
    skills: [
      "Find the beat and stay in it",
      "Move big without losing balance",
      "Learn choreography faster",
      "Build an eight-count from scratch",
      "Perform instead of just executing",
    ],
    prices: [
      { interval: "month", amount: 1900 },
      { interval: "year", amount: 19000 },
    ],
    courses: [
      {
        key: "dance-1",
        title: "Foundations of Movement",
        description: "Rhythm, posture and the confidence to take up space.",
        lessons: [
          L(
            "Musicality before moves",
            8,
            20,
            paras(
              "Dancers don't count because they love math — they count because the music is the choreography's skeleton. Before any steps, we train your ear: find the 1, feel the 8, hear where the music breathes.",
              "The daily drill: one song, no moves allowed — just walk the beat, clap the accents, nod the phrases. Boring for three days, transformative by day seven.",
              "Once your body knows where the 1 lives, every step you ever learn will land twice as fast. Rhythm is the slowest skill to build and the most permanent.",
            ),
          ),
          L(
            "Grounded: posture and weight",
            9,
            55,
            paras(
              "Confidence on the floor is physics: knees soft, weight low, chest proud. Stiff knees and a held breath read as fear from across the room — and feel like it from inside.",
              "We'll drill weight shifts until they're invisible: side to side, front to back, through the hips not the shoulders. Every style — hip-hop, salsa, contemporary — is weight transfer wearing different clothes.",
              "Film yourself for thirty seconds today and watch it without cringing. That's not vanity; it's the fastest feedback loop in dance.",
            ),
          ),
          L(
            "Learn choreography faster",
            7,
            30,
            paras(
              "Picking up choreography is its own skill, separate from dancing. The trick: chunk it. Eight counts at a time, name each chunk out loud ('punch, slide, roll'), and mark it small before you dance it big.",
              "Watch the teacher's feet first, arms second — feet carry the structure, arms carry the style. And dance it wrong at full energy rather than right at half energy; corrections stick to moving bodies.",
              "End every session by performing what you have, even if it's four counts. Memory consolidates under mild pressure, and performing IS the skill.",
            ),
          ),
        ],
      },
      {
        key: "dance-2",
        title: "Choreography: From Idea to Stage",
        description: "Build phrases, shape space and turn movement into meaning.",
        lessons: [
          L(
            "Your first eight counts",
            10,
            25,
            paras(
              "A blank studio is scarier than a blank page. So we never start blank: steal a pedestrian gesture — checking a phone, waving, falling asleep — and stylize it: bigger, slower, sharper, on the beat.",
              "Three gestures, three treatments, and you have an eight-count with a point of view. Originality isn't inventing movement from nothing; it's a personal filter on the ordinary.",
              "Record everything. Choreography evaporates — the phone in the corner is your notebook.",
            ),
          ),
          L(
            "Space, levels and the audience's eye",
            9,
            15,
            paras(
              "Choreography is composition in motion: where bodies are, how high, facing where. A phrase performed in a line, then a diagonal, then a cluster becomes three different pieces.",
              "We'll play with levels (floor, mid, air), unison versus canon, and stillness — the most underused move in dance. The eye goes where the change is; control the change and you control the room.",
              "Block your piece on paper with dots and arrows before the studio. Five minutes of drawing saves an hour of 'wait, where do I stand?'",
            ),
          ),
          L(
            "Perform it like you mean it",
            6,
            40,
            paras(
              "The last ten percent — face, breath, intention — is what audiences actually remember. Steps executed perfectly with dead eyes lose to simple movement performed with conviction, every single time.",
              "We'll attach one word to each section of your piece — 'defiant', 'playful', 'done' — and let the word drive the face and the breath. Acting and dancing are the same job at this layer.",
              "Then the dress-rehearsal rule: full out, in costume shoes, filmed, twice. The performance you rehearse is the one that shows up under lights.",
            ),
          ),
        ],
      },
    ],
  },
  {
    key: "film",
    theme: "film",
    name: "Filmmaking: Script to Screen",
    slug: "filmmaking-script-to-screen",
    type: "PAID",
    description:
      "Make the short film you keep talking about. Story, directing, cinematography, sound and the edit — a complete path from idea to a finished film you're proud to screen.",
    categories: ["seed-lvlcat-film"],
    skills: [
      "Write a short that fits your budget",
      "Direct actors with playable notes",
      "Light and frame with what you have",
      "Record sound people can actually hear",
      "Cut for emotion, not coverage",
      "Finish and screen the thing",
    ],
    prices: [
      // 6 monthly installments, then lifetime access — the installments demo.
      { interval: "month", amount: 9900, installments: 6 },
      { interval: "month", amount: 4900 },
    ],
    courses: [
      {
        key: "film-1",
        title: "The Director's Craft",
        description: "Story, shot-listing and getting performances you can cut to.",
        lessons: [
          L(
            "Write small, mean it",
            9,
            30,
            paras(
              "Your first films should be small enough to finish and sharp enough to matter: one location, two characters, one irreversible moment. Constraint isn't the enemy of ambition — it's the disguise ambition wears on no budget.",
              "We'll pressure-test your idea with three questions: What changes? Whose film is it? Why today and not any other day of these characters' lives?",
              "Then the one-page treatment: beginning, turn, end — no dialogue yet. If the silent version doesn't work, dialogue won't save it; film is pictures first.",
            ),
          ),
          L(
            "The shot list is the film",
            11,
            40,
            paras(
              "A director's real job happens before the set: deciding what the camera sees and why. Wide establishes, medium relates, close-up testifies — each size is a sentence in the visual grammar.",
              "We'll break your script into beats and give each beat a shot with a REASON: whose scene is it, where's the power, what must the audience notice? Coverage without intention is just expensive indecision.",
              "Storyboard with stick figures or phone photos of action figures — beauty irrelevant, clarity everything. On the day, the list is your spine; the inspired extra shot is dessert, never dinner.",
            ),
          ),
          L(
            "Directing actors: playable notes",
            10,
            15,
            paras(
              "'Be sadder' is not a note — it's a wish. Actors play actions, not adjectives: 'try to make her stay' is playable; 'be desperate' is homework you just handed them mid-take.",
              "We'll build your verb vocabulary (to convince, to punish, to confess, to hide) and practice the thirty-second adjustment: one verb change between takes, never a paragraph.",
              "Cast people you like, feed everyone, and protect take three — the first is mechanics, the second is memory, the third is where the accident you'll keep usually lives.",
            ),
          ),
        ],
      },
      {
        key: "film-2",
        title: "Cinematography & Sound",
        description: "Lighting, lenses and the sound that secretly carries your film.",
        lessons: [
          L(
            "Light with motivation",
            10,
            55,
            paras(
              "Good lighting looks like it came from somewhere: a window, a lamp, a streetlight. Start with the practical source the room gives you, then help it — bounce it, soften it, cut it.",
              "The one-light film school: a single soft source 45° off the face, white card opposite for fill, and the room's own lamps as background interest. That setup shoots ninety percent of indie scenes.",
              "We'll also steal time of day: golden hour for romance, overcast for honesty, night windows for menace. The sun is the best gaffer who works for free.",
            ),
          ),
          L(
            "Lenses tell the story",
            8,
            45,
            paras(
              "Wide lenses make spaces and isolation; long lenses make intimacy and compression. The same conversation shot at 24mm and 85mm is two different scenes — pick by feeling, not by what's on the camera.",
              "We'll define your film's lens rules in one line ('we live on a 35 and only go long when she lies') so the photography has a spine the audience feels without naming.",
              "Movement earns its keep the same way: a push-in means something is changing; handheld means stability is gone. If the camera moves, the story moved first.",
            ),
          ),
          L(
            "Sound is half the picture",
            12,
            0,
            paras(
              "Audiences forgive soft focus; they do not forgive unintelligible dialogue. The boom mic two feet above the actor beats the camera mic across the room, every time, no exceptions.",
              "We'll cover the no-budget kit — one shotgun mic, one pole, one set of headphones actually worn by an actual human — and the on-set ritual: thirty seconds of room tone before anyone wraps a location.",
              "Layer in post: clean dialogue, room tone under everything, two or three honest effects, music last and quieter than you want. Sound design is where cheap films become invisible-budget films.",
            ),
          ),
        ],
      },
      {
        key: "film-3",
        title: "The Edit Room",
        description: "Where the film is actually written — rhythm, ruthlessness, release.",
        lessons: [
          L(
            "The edit is the final rewrite",
            9,
            50,
            paras(
              "Your footage is not your film; it's the lumber. First assembly will be long and flabby — that's its job. Watch it once, no stopping, notes on paper: where were you bored, where were you confused, where did you feel something?",
              "Cut for the performance, not the plan. The shot list got you the material; loyalty to it now is sunk-cost filmmaking. If the scene plays better without your favorite shot, the favorite goes.",
              "Rhythm rule of thumb: enter scenes late, leave early, and let reactions — not lines — carry the cuts. The story lives on the listener's face.",
            ),
          ),
          L(
            "Finish it: color, mix, screen",
            8,
            10,
            paras(
              "Finishing is a discipline: a light color pass for consistency before style, a dialogue-first mix with music pulled down two more dB than feels right, titles that are readable and brief.",
              "Then export, watch it ONCE on a TV with people who love you, fix only what's broken, and stop. Version seventeen is where short films go to die.",
              "Screen it — a festival, a bar night, a living room with folding chairs. A film isn't finished when you export; it's finished when strangers have felt it. Then start writing the next one.",
            ),
          ),
        ],
      },
    ],
  },
  {
    key: "comedy",
    theme: "comedy",
    name: "Stand-Up Comedy & Performance",
    slug: "stand-up-comedy-performance",
    type: "PAID",
    description:
      "Be funnier on purpose. Find your premises, build jokes with real mechanics, survive your first open mics and turn stage fright into stage presence.",
    categories: ["seed-lvlcat-comedy", "seed-lvlcat-film"],
    skills: [
      "Mine your life for premises",
      "Build setups and punchlines that hit",
      "Handle silence without dying",
      "Work a crowd, not against it",
      "Turn five okay minutes into five tight ones",
    ],
    prices: [
      { interval: "month", amount: 2500 },
      { interval: "year", amount: 25000 },
    ],
    courses: [
      {
        key: "comedy-1",
        title: "Finding the Funny",
        description: "Premises, punchlines and the notebook habit behind every tight five.",
        lessons: [
          L(
            "Premises are everywhere",
            8,
            40,
            paras(
              "Comedy starts with noticing, not with jokes. The premise is your honest, specific take on something real: what's weird, what's annoying, what does everyone pretend about?",
              "We'll start the comic's notebook: every day, three observations written as 'It's weird that…', 'I hate it when…', 'Nobody admits…'. No punchlines allowed yet — premises first, like a cook prepping before the flame.",
              "Your funniest material will come from what you actually know: your job, your family, your body, your phone. Specific is funny; general is a greeting card.",
            ),
          ),
          L(
            "Joke mechanics: setup, punch, tag",
            10,
            30,
            paras(
              "A joke is a tiny machine: the setup creates an assumption, the punchline breaks it, the tag breaks it again for free. Economy is everything — every unnecessary word is a speed bump before the laugh.",
              "We'll take three premises from your notebook and build each one out: list ten angles, write the punch FIRST sometimes, then sand the setup down to the fewest words that still load the assumption.",
              "Then the rule of threes, act-outs and the comparison engine ('X is just Y for Z'). Mechanics won't make you funny — they make your funny land.",
            ),
          ),
          L(
            "Your first open mic",
            9,
            20,
            paras(
              "The open mic is the gym, not the show. Three minutes, material you've actually rehearsed out loud, recorded on your phone from the back of the room. That recording is the whole point of the night.",
              "Expect silence — newcomers' material is usually 30% as funny on stage as in their head, and that's NORMAL. The gap closes with stage time and nothing else.",
              "Afterwards: listen to the tape once, mark what got anything (a laugh, a smile, a breath), keep those seconds, rewrite the rest. Five mics in, you'll have one real minute. That's how everyone starts — everyone.",
            ),
          ),
        ],
      },
      {
        key: "comedy-2",
        title: "Owning the Stage",
        description: "Presence, crowd work and turning panic into timing.",
        lessons: [
          L(
            "Stage presence is borrowed confidence",
            7,
            50,
            paras(
              "The audience decides if you're funny in the first fifteen seconds — mostly from how you walk, plant and breathe. Move with intention, take the mic out of the stand like you've done it before, and pause before your first word.",
              "Slow is power. Nerves rush; pros let silence sit while the room leans in. We'll drill the two-second hold after every punchline — the laugh needs room to land.",
              "And memorize your opener and closer cold. A strong first joke buys you five minutes of goodwill; a strong last one is what the room remembers in the car.",
            ),
          ),
          L(
            "Crowd work and recovery",
            9,
            5,
            paras(
              "Crowd work isn't insult comedy — it's curiosity with timing. Ask real questions, listen for the gift in the answer, and always punch sideways or up, never down at the person who trusted you with a reply.",
              "Bombing is a rite, not a verdict. Have your recovery lines ready ('I'll wait', 'that one's for the ride home') and remember the room's secret: they're rooting for you — silence embarrasses them too.",
              "Heckles get one warning shot, then the host. The audience hires you to keep the night safe and funny, in that order — and handling it gracefully IS the bit.",
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
    ["seed-lvlcat-music", "Music", 0],
    ["seed-lvlcat-food", "Food", 1],
    ["seed-lvlcat-photo", "Photography", 2],
    ["seed-lvlcat-dance", "Dance", 3],
    ["seed-lvlcat-film", "Film & TV", 4],
    ["seed-lvlcat-comedy", "Comedy", 5],
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
      imageUrl: art(cls.theme, 0),
      trailerUrl: TRAILER,
      audienceTags: [cls.slug],
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
          thumbnailUrl: art(cls.theme, c + 1),
          coverImageUrl: art(cls.theme, c + 1),
        },
        create: {
          id: courseId,
          title: course.title,
          description: course.description,
          order: c,
          thumbnailUrl: art(cls.theme, c + 1),
          coverImageUrl: art(cls.theme, c + 1),
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
  for (const levelId of ["seed-class-music", "seed-class-cooking"]) {
    await prisma.userLevel.upsert({
      where: {
        userId_levelId_source: { userId: memberId, levelId, source: "MANUAL" },
      },
      update: { status: "ACTIVE", expiresAt: null },
      create: { userId: memberId, levelId, source: "MANUAL", status: "ACTIVE" },
    });
  }
  for (const lessonId of [
    "seed-lesson-music-1-1",
    "seed-lesson-music-1-2",
    "seed-lesson-cooking-1-1",
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
    ["seed-postcat-tips", "Tips & Technique", "tips-and-technique", 2],
    ["seed-postcat-behind", "Behind the Scenes", "behind-the-scenes", 3],
    ["seed-postcat-creative", "Creative Living", "creative-living", 4],
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
        "A faster home for your classes — on the web and in the app, always in sync.",
      content:
        "<p>Welcome to the new member portal — rebuilt from the ground up around the way people actually learn a craft.</p><h2>What's new</h2><ul><li>A classes-first dashboard that remembers where you left off</li><li>Every lesson on web and mobile, always in sync</li><li>A brand-new public blog with weekly tips from every discipline</li></ul><p>Log in, pick your class, and make something today.</p>",
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
      id: "seed-post-practice",
      slug: "practice-habits-that-actually-stick",
      title: "Practice habits that actually stick",
      excerpt:
        "Musicians, dancers, comics — the craft changes, the practice psychology doesn't. Five rules from people who kept going.",
      content:
        "<p>Every craft on this platform — music, dance, cooking, comedy — runs on the same hidden engine: practice you actually do. Here's what the people who stuck with it have in common.</p><h2>1. Shrink the session</h2><p>Twenty focused minutes beats the mythical free Saturday. The floor should be so low it's embarrassing to skip: one song section, one eight-count, one knife drill.</p><h2>2. Same time, same trigger</h2><p>Habits attach to existing routines. After coffee, before dinner, when the dishwasher starts — the trigger matters more than the hour.</p><h2>3. Practice the hard 20%</h2><ul><li>Musicians: loop the four bars you fumble, not the whole song</li><li>Dancers: drill the transition, not the choreography</li><li>Comics: rewrite the bit that died, don't re-read the one that killed</li></ul><h2>4. Record everything</h2><p>The phone in the corner is the most honest teacher you'll ever have — and proof, three months later, of how far you've come.</p><h2>5. End on a win</h2><p>Finish each session with something you can already do well. Your brain files the session under \"that went great\", and tomorrow's session gets easier to start.</p>",
      status: "PUBLISHED",
      publishedAt: "2026-05-05T09:00:00Z",
      categoryIds: ["seed-postcat-tips"],
      tags: ["practice", "habits", "music", "dance"],
    },
    {
      id: "seed-post-plating",
      slug: "plate-like-a-chef-five-rules",
      title: "Plate like a chef: five rules that change everything",
      excerpt:
        "The food is already good — these thirty-second moves make it look like it came from a kitchen with a pass.",
      content:
        "<p>Restaurant plates aren't magic; they're habits. Steal these five and tonight's dinner photographs itself.</p><h2>1. Warm plates, always</h2><p>A cold plate kills sauces and shortens the meal's best minutes. Thirty seconds under hot tap water is enough.</p><h2>2. Odd numbers, off center</h2><p>Three things look composed; four look catered. Let the food sit slightly off-center — symmetry reads as cafeteria.</p><h2>3. Height beats sprawl</h2><p>Stack and lean instead of spreading. A plate with a skyline looks intentional; a plate with suburbs looks like leftovers.</p><h2>4. Sauce under, not over</h2><p>A spoonful swept under the protein keeps textures crisp and looks deliberate. The squeeze-bottle zigzag retired in 2009.</p><h2>5. Finish with contrast</h2><ol><li>Something green (soft herbs, micro anything)</li><li>Something crunchy (toasted seeds, crispy shallots)</li><li>Something glossy (good olive oil, a citrus wedge)</li></ol><p>Four touches, thirty seconds, every plate. Your stew didn't change — dinner did.</p>",
      status: "PUBLISHED",
      publishedAt: "2026-05-12T09:00:00Z",
      categoryIds: ["seed-postcat-tips"],
      tags: ["cooking", "plating", "hosting"],
    },
    {
      id: "seed-post-golden-hour",
      slug: "golden-hour-is-a-cheat-code",
      title: "Golden hour is a cheat code (use it this week)",
      excerpt:
        "The hour after sunrise and before sunset makes everyone a better photographer. Here's how to actually use it.",
      content:
        "<p>Ask any photographer their secret and half will say the same thing: show up when the light is already doing the work. Golden hour — the soft hour after sunrise and before sunset — flatters faces, buildings, food and dogs alike.</p><h2>Why it works</h2><p>The sun sits low, so light travels through more atmosphere: softer shadows, warmer color, and a direction you can actually use instead of harsh overhead glare.</p><h2>Three setups to try</h2><ul><li><strong>Backlight:</strong> subject between you and the sun — instant halo, dreamy flare. Expose for the face, let the background glow.</li><li><strong>Side light:</strong> sun at 90° — texture and drama for portraits and streets.</li><li><strong>Open shade + golden bounce:</strong> subject just inside shade, lit by the warm bounce — the most flattering portrait light that exists for free.</li></ul><h2>The one-week assignment</h2><p>Check tonight's golden hour time, set an alarm, and shoot the same subject three evenings this week. Same subject, same spot, different minutes — then watch what twenty minutes of sun angle does to a photograph.</p>",
      status: "PUBLISHED",
      publishedAt: "2026-05-19T09:00:00Z",
      categoryIds: ["seed-postcat-tips", "seed-postcat-featured"],
      tags: ["photography", "light"],
    },
    {
      id: "seed-post-adult-dance",
      slug: "learning-to-dance-as-an-adult",
      title: "Learning to dance as an adult (yes, you)",
      excerpt:
        "No childhood ballet, no rhythm, no problem. What actually happens in your first three months on the floor.",
      content:
        "<p>The biggest myth in dance is that the door closes at twelve years old. Studios are full of adults who started at thirty, forty and well past — here's the honest version of those first months.</p><h2>Weeks 1–2: everything is left</h2><p>You will mix up left and right. Everyone does. Stand in the middle of the room (not the back — you'll only see other confused beginners) and steal glances at the teacher's feet.</p><h2>Weeks 3–6: your body starts listening</h2><p>The counts stop being math and start being music. The win at this stage isn't looking good — it's finishing a combination without your brain bluescreening.</p><h2>Months 2–3: the first real dance</h2><p>One class, one song, something clicks: you stop translating and just move. It lasts eight counts. It's the hook that keeps every dancer coming back.</p><h2>Stack the deck</h2><ul><li>Pick a style you love watching — joy survives plateaus, obligation doesn't</li><li>Go twice a week; once a week is permanent beginner mode</li><li>Film the last two minutes of every class — progress hides from mirrors but not from cameras</li></ul><p>The room isn't judging you. The room is concentrating on its own feet.</p>",
      status: "PUBLISHED",
      publishedAt: "2026-05-26T09:00:00Z",
      categoryIds: ["seed-postcat-creative"],
      tags: ["dance", "beginners"],
    },
    {
      id: "seed-post-watch-movies",
      slug: "how-to-watch-movies-like-a-filmmaker",
      title: "How to watch movies like a filmmaker",
      excerpt:
        "Turn your watchlist into film school: a simple rewatch ritual that trains your eye without ruining the fun.",
      content:
        "<p>Filmmakers don't watch more movies than you — they watch them differently. The good news: the skill is learnable, and it makes movies better, not worse.</p><h2>First watch: stay a civilian</h2><p>Feel the film the way audiences will. Notice only one thing: the moments that got you — a cut that made you gasp, a scene you leaned into. Write down the timestamps.</p><h2>Second watch: visit your timestamps</h2><p>Go back to the three moments that worked and ask the filmmaker questions:</p><ul><li>Where is the camera, and whose scene does that make it?</li><li>When did the cut happen — on the line, or on the reaction?</li><li>What do you hear besides dialogue?</li><li>What color is this scene, and when did the palette change?</li></ul><h2>Steal one thing per film</h2><p>One technique per movie goes into your notebook: the late scene entrance, the silence before the punchline, the push-in on a lie. Ten films later you'll own a toolbox; thirty films later you'll spot the tools in your own footage.</p><p>That's the whole ritual. The popcorn still tastes the same — but now the movie is teaching while it plays.</p>",
      status: "PUBLISHED",
      publishedAt: "2026-06-02T09:00:00Z",
      categoryIds: ["seed-postcat-behind", "seed-postcat-featured"],
      tags: ["film", "directing", "watchlist"],
    },
    {
      id: "seed-post-stage-fright",
      slug: "stage-fright-into-stage-presence",
      title: "Turning stage fright into stage presence",
      excerpt:
        "Comics, singers, speakers — the fear is identical, and so is the fix. A field guide to the first sixty seconds.",
      content:
        "<p>Every performer you admire still feels it: the dry mouth, the fast heart, the sudden amnesia in the wings. The pros haven't deleted fear — they've changed its job description.</p><h2>Rename the feeling</h2><p>Adrenaline before fear and excitement is chemically identical. Saying \"I'm ready\" instead of \"I'm nervous\" sounds like a trick because it is one — and in studies it works anyway.</p><h2>Own the first sixty seconds</h2><p>Panic lives in uncertainty, so remove it from the open: memorize your first minute cold — the walk, the plant, the first line, the pause. After sixty scripted seconds, the body settles and the craft takes over.</p><h2>The pre-stage ritual</h2><ol><li>Slow exhale, twice as long as the inhale — four rounds</li><li>Shoulders down, jaw loose, one big silent yawn</li><li>One physical anchor: feet on the floor, hand on the mic stand</li></ol><h2>And after: log the win</h2><p>The fear's favorite lie is \"that was a disaster\". The recording says otherwise. Watch it once, write down two things that worked, one to fix. Presence is just fright plus repetitions — every stage you've loved was built on knees that shook.</p>",
      status: "PUBLISHED",
      publishedAt: "2026-06-09T09:00:00Z",
      categoryIds: ["seed-postcat-creative", "seed-postcat-tips"],
      tags: ["performance", "comedy", "confidence"],
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
      placeholder: "Alex Rivera",
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
      options: ["Classes & membership", "Billing", "Something else"],
    },
    {
      id: "f-message",
      type: "textarea",
      label: "How can we help?",
      name: "message",
      required: true,
      placeholder: "Tell us what you're working on…",
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
      name: "Backstage Notes (newsletter)",
      fields: newsletterFields,
      status: "ACTIVE",
      tags: ["newsletter"],
      successMessage: "You're in — see you backstage.",
    },
    create: {
      id: "seed-form-newsletter",
      name: "Backstage Notes (newsletter)",
      fields: newsletterFields,
      status: "ACTIVE",
      tags: ["newsletter"],
      successMessage: "You're in — see you backstage.",
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
        seoTitle: "About Spotlight Academy",
        description:
          "Online classes in music, food, photography, dance, film and comedy — learn from working artists, at your pace.",
        ogImage: art("film", 0),
      },
    },
    content: [
      {
        type: "Hero",
        props: {
          id: "about-hero",
          eyebrow: "Spotlight Academy",
          title: "Everyone deserves a craft they love.",
          subtitle:
            "Music, cooking, photography, dance, film and comedy — taught the way working artists actually learned: short lessons, real practice, honest feedback.",
          buttonLabel: "Explore the classes",
          buttonHref: "/pricing/all",
          align: "center",
          background: "dark",
          backgroundColor: "",
        },
      },
      {
        type: "Stats",
        props: {
          id: "about-stats",
          columns: "3",
          items: [
            { value: "6", label: "Crafts, one membership" },
            { value: "40+", label: "Lessons in the catalog" },
            { value: "10 min", label: "Average lesson length" },
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
          html: "<p>Most people quietly carry a craft they've always wanted: the guitar in the corner, the camera from two birthdays ago, the dinner party they keep postponing. Spotlight Academy exists to get you past wanting and into doing — with classes built from short, watchable lessons and assignments you can finish on a weeknight.</p><p>No gatekeeping, no five-hour theory dumps. Every lesson teaches one thing you can practice today, because the people who get good aren't the most talented — they're the ones who kept showing up.</p>",
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
            { text: "Short lessons built for busy lives" },
            { text: "Real assignments, not just videos" },
            { text: "Six crafts under one membership" },
            { text: "Web and mobile — progress everywhere" },
            { text: "Beginner-safe, never beginner-only" },
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
              title: "Make music",
              text: "Songwriting and home production — free with every membership.",
              imageUrl: art("music", 0),
              href: "/classes/music-production-songwriting",
            },
            {
              title: "Cook with confidence",
              text: "Knife skills, heat and flavor instincts that retire your recipes.",
              imageUrl: art("food", 0),
              href: "/classes/the-art-of-cooking",
            },
            {
              title: "Tell stories on screen",
              text: "From script to screening night — the complete filmmaking path.",
              imageUrl: art("film", 1),
              href: "/classes/filmmaking-script-to-screen",
            },
          ],
        },
      },
      {
        type: "Testimonial",
        props: {
          id: "about-quote",
          quote:
            "I joined for the cooking class and somehow ended up performing five minutes at an open mic. This place is dangerous in the best way.",
          author: "Dana M.",
          role: "Member since 2025",
          avatarUrl: avatarImg("dana"),
          design: { background: "#18181b", textColor: "#fafafa", radius: 16, paddingY: 24, paddingX: 24 },
        },
      },
      {
        type: "FAQ",
        props: {
          id: "about-faq",
          items: [
            {
              question: "I'm a complete beginner. Is this for me?",
              answer:
                "Yes — every class starts from zero and builds in small steps. Music Production & Songwriting is free with every membership, so you can start today.",
            },
            {
              question: "How much time do I need?",
              answer:
                "Lessons average about ten minutes, and every class is built around short daily practice rather than marathon sessions. Most members spend 2–3 hours a week.",
            },
            {
              question: "Can I switch between crafts?",
              answer:
                "Anytime. One membership, six crafts — binge one class or sample them all; your progress is saved everywhere.",
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
          title: "Pick your craft.",
          subtitle: "Start free with Music Production & Songwriting — today counts.",
          buttonLabel: "Start learning",
          buttonHref: "/classes/music-production-songwriting",
          background: "brand",
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
        seoTitle: "Start Here — Spotlight Academy",
        description: "New to Spotlight Academy? Your first week, mapped.",
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
            "Five minutes of orientation, then straight into the fun part. Here's exactly what to do first.",
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
                html: "<p>Don't binge — build. The members who actually get good all start the same way:</p>",
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
                  { text: "Day 1: Pick ONE craft (you can switch anytime — but start with one)" },
                  { text: "Day 2: Watch the first two lessons of its first course (~15 minutes)" },
                  { text: "Day 3–4: Do the lesson assignment — make something small and bad, on purpose" },
                  { text: "Day 5: Book your practice slot: 20 minutes, same time, most days" },
                  { text: "Weekend: Finish the first course and tell one person what you made" },
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
                html: "<h3>Not sure where to start?</h3><p><strong>Music Production & Songwriting</strong> is free with every membership — six lessons in, you'll have written a hook and recorded it. It's the fastest 'I made a thing' on the platform.</p>",
                align: "left",
              },
            },
            {
              type: "RichText",
              props: {
                id: "sh-path-goal",
                html: "<h3>Chasing something specific?</h3><p>Dinner party in three weeks → <strong>The Art of Cooking</strong>. A short film by summer → <strong>Filmmaking: Script to Screen</strong>. Five minutes on a stage → <strong>Stand-Up Comedy & Performance</strong>.</p>",
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
        seoTitle: "Contact — Spotlight Academy",
        description: "Questions about classes or your membership? Write to us.",
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
          html: "<p>Questions about a class, your membership, or which craft to pick first? Send a note — a real person reads every message, and we reply within two business days.</p>",
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
          html: "<p>Prefer email? Write to <a href=\"mailto:hello@spotlightacademy.example\">hello@spotlightacademy.example</a>.</p>",
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
    name: "Welcome to Spotlight Academy",
    status: "ACTIVE" as const,
    position: "CENTER" as const,
    width: "480px",
    height: "auto",
    background: "#ffffff",
    borderColor: "#e4e4e7",
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
          props: { id: "wp-h", text: "Welcome back 👋", level: "2", align: "center" },
        },
        {
          type: "RichText",
          props: {
            id: "wp-t",
            html: "<p>Your craft gets better one session at a time — and the next one is right here. New around the Academy? The Start Here page maps your first week.</p>",
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
    name: "Filmmaking installment promo",
    status: "ACTIVE" as const,
    position: "BOTTOM_RIGHT" as const,
    width: "400px",
    height: "auto",
    background: "#18181b",
    borderColor: "#3f3f46",
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
            text: "Make your film this year",
            level: "3",
            align: "left",
            design: { textColor: "#fafafa" },
          },
        },
        {
          type: "RichText",
          props: {
            id: "pp-t",
            html: "<p>Filmmaking: Script to Screen now has a 6-payment plan — finish paying, keep it for life.</p>",
            align: "left",
            design: { textColor: "#d4d4d8" },
          },
        },
        {
          type: "Button",
          props: {
            id: "pp-b",
            label: "See the plan",
            href: "/checkout/filmmaking-script-to-screen",
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
  // Colors snapshot the admin's live styling (set in Admin → Appearance on
  // 2026-06-12: dark indigo bar) so a re-seed restores THEIR look, not ours.
  const headerConfig = {
    layout: "THREE_COL",
    width: "BOXED",
    maxWidth: 1080,
    bgColor: "#2d337b",
    paddingX: 24,
    paddingY: 10,
    logoUrl: null,
    menuId: "seed-menu-header",
    linkColor: "#c6c6d7",
    menuActiveColor: "#dbc2c2",
    ctas: [
      {
        id: "cta-join",
        label: "Browse classes",
        bgColor: "#ca5353",
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
    bgColor: "#111113",
    textColor: "#d4d4d8",
    headingColor: "#ffffff",
    linkColor: "#e4e4e7",
    paddingY: 48,
    logoUrl: null,
    tagline: "Learn from the best. Love what you make.",
    menuHeading: "Explore",
    menuId: "seed-menu-footer",
    email: {
      heading: "Backstage Notes",
      text: "One technique and one piece of inspiration, every Tuesday.",
      placeholder: "you@email.com",
      buttonText: "Subscribe",
      audienceId: null,
      audienceName: null,
      doubleOptIn: false,
      successMessage: "You're in — see you backstage.",
    },
    copyright: "© {year} Spotlight Academy. All rights reserved.",
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

// ---------- certificate templates ----------

// Two demo templates with committed artwork (assets/certificates/*.png). The
// PNGs are COPIED into the API's media dir under stable keys so templates
// reference normal /media/<key> URLs (renders never leave the box). The
// "classic" cream design is the default; "spotlight" is the dark variant —
// admins can flip the default or assign per class. Field layouts follow the
// shared CertificateFieldLayout contract (% of artwork; fonts from
// CERTIFICATE_FONTS).
async function seedCertificateTemplates() {
  const apiSrc = path.resolve(__dirname, "../../../apps/api/src");
  const mediaRoot = process.env.MEDIA_DIR || path.join(apiSrc, "media-uploads");
  fs.mkdirSync(mediaRoot, { recursive: true });

  const assets = [
    {
      file: "cert-classic.png",
      key: "seed-cert-classic.png",
      mediaId: "seed-media-cert-classic",
      title: "Certificate artwork — Classic Cream",
    },
    {
      file: "cert-spotlight.png",
      key: "seed-cert-spotlight.png",
      mediaId: "seed-media-cert-spotlight",
      title: "Certificate artwork — Spotlight Dark",
    },
  ];
  for (const a of assets) {
    const src = path.join(__dirname, "assets", "certificates", a.file);
    fs.copyFileSync(src, path.join(mediaRoot, a.key));
    const size = fs.statSync(src).size;
    const mediaData = {
      key: a.key,
      originalName: a.file,
      mimeType: "image/png",
      size,
      width: 1600,
      height: 1131,
      title: a.title,
    };
    await prisma.mediaAsset.upsert({
      where: { id: a.mediaId },
      update: mediaData,
      create: { id: a.mediaId, ...mediaData },
    });
  }

  // Shared placement: script name above a serif class title, date + serial in
  // the bottom corners (inside the artwork's frame).
  const fieldsFor = (text: string, soft: string) => [
    { kind: "memberName", enabled: true, xPct: 10, yPct: 40, widthPct: 80, align: "center", fontFamily: "greatvibes", fontSizePct: 7, color: text, uppercase: false },
    { kind: "className", enabled: true, xPct: 10, yPct: 57, widthPct: 80, align: "center", fontFamily: "playfair", fontSizePct: 3.4, color: text, uppercase: false },
    { kind: "issueDate", enabled: true, xPct: 9, yPct: 87, widthPct: 30, align: "left", fontFamily: "inter", fontSizePct: 1.5, color: soft, uppercase: false },
    { kind: "serial", enabled: true, xPct: 61, yPct: 87, widthPct: 30, align: "right", fontFamily: "inter", fontSizePct: 1.3, color: soft, uppercase: false, letterSpacing: 0.06 },
  ];

  const templates = [
    {
      id: "seed-cert-template-classic",
      name: "Classic Cream",
      artworkUrl: "/media/seed-cert-classic.png",
      isDefault: true,
      fields: fieldsFor("#18181b", "#52525b"),
    },
    {
      id: "seed-cert-template-spotlight",
      name: "Spotlight Dark",
      artworkUrl: "/media/seed-cert-spotlight.png",
      isDefault: false,
      fields: fieldsFor("#f4f4f6", "#b48e3c"),
    },
  ];
  for (const t of templates) {
    const data = {
      name: t.name,
      artworkUrl: t.artworkUrl,
      imageWidth: 1600,
      imageHeight: 1131,
      fields: t.fields as Prisma.InputJsonValue,
      isDefault: t.isDefault,
    };
    await prisma.certificateTemplate.upsert({
      where: { id: t.id },
      update: data,
      create: { id: t.id, ...data },
    });
  }
  // Exactly one default: if an admin promoted another template, the re-seed
  // restores the canonical state (full-update convention).
  await prisma.certificateTemplate.updateMany({
    where: { id: { notIn: templates.map((t) => t.id) }, isDefault: true },
    data: { isDefault: false },
  });
  console.log("✓ certificate templates (classic default + spotlight dark)");
}

// ---------- app customization (mobile branding) ----------

async function seedAppConfig() {
  // The app mirrors the web member area's "liquid glass" design: a deep
  // violet-ink canvas with a violet #7c5cfc primary (pink accents come from the
  // gradients). The app ships dark by default; both palettes are the web's exact
  // tokens (= cross-stack defaults in apps/mobile/src/theme.ts /
  // app-config.service.ts). Admins can still recolor live via App Customization.
  const config = {
    title: "Spotlight Academy",
    tagline: "Learn from the best. Love what you make.",
    description:
      "Online classes in music, food, photography, dance, film and comedy — short lessons, real practice, taught by working artists.",
    logoUrl: null,
    iconUrl: null,
    splashUrl: null,
    colorScheme: "dark",
    light: {
      bg: "#f5f3fc",
      surface: "#ffffff",
      surfaceMuted: "#f2eefb",
      border: "#e7e2f4",
      text: "#251f3d",
      textMuted: "#8b84a4",
      primary: "#7c5cfc",
      danger: "#e11d48",
    },
    dark: {
      bg: "#100c1b",
      surface: "#211a33",
      surfaceMuted: "#2a2240",
      border: "#342a4f",
      text: "#f4f1fb",
      textMuted: "#948cb4",
      primary: "#7c5cfc",
      danger: "#f2557b",
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
  await seedCertificateTemplates();
  await seedMemberState(memberId);

  const counts = {
    classes: CLASSES.length,
    courses: CLASSES.reduce((n, c) => n + c.courses.length, 0),
    lessons: CLASSES.reduce(
      (n, c) => n + c.courses.reduce((m, co) => m + co.lessons.length, 0),
      0,
    ),
  };
  console.log("Seed complete — Spotlight Academy demo content.");
  console.log(`  Admin:   admin@example.com / ${adminPassword}`);
  console.log(
    "  Member:  member@example.com / member123 (enrolled in Music + Cooking)",
  );
  console.log(
    `  Catalog: ${counts.classes} classes · ${counts.courses} courses · ${counts.lessons} lessons (+ QA fixtures)`,
  );
  console.log("  Blog:    7 published posts + 1 draft · 5 categories");
  console.log("  Pages:   /about · /start-here · /contact (+ coming-soon draft)");
  console.log("  Popups:  welcome (dashboard) + promo (class pages)");
  console.log("  Nav:     header menu + CTA · footer with newsletter");
  console.log("  App:     'Spotlight Academy' branding (dark, matches the web)");
  console.log("  Certs:   2 templates (Classic Cream default + Spotlight Dark)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
