// Guards the PROVISIONING CONTRACT of prisma/seed.ts against a THROWAWAY
// database (never the dev DB): the control plane provisions an instance with
// SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD (+ SEED_DEMO_CONTENT) and its "Admin
// login" panel discloses exactly those credentials — so the seed MUST make
// them work, in BOTH demo modes, and must keep working across container
// restarts (the instance compose re-runs the seed on every boot).
//
// Second contract, same stakes: with SEED_DEMO_ONCE=true (a literal in the
// instance compose) demo content is a ONE-SHOT template. It seeds on the first
// boot, is recorded in SeedState, and is never re-imposed — a restart must not
// resurrect a class the client deleted or revert an image/branding they
// changed (scenarios 8–10; this shipped broken once — live instances lost
// client edits on every deploy).
//
// Regression history: the env-driven first admin from 66b75a2 was lost in the
// d5502c8 seed rewrite, shipping every provisioned instance with only
// admin@example.com/admin123 (verified live 2026-07-08). This check exists so
// that can't happen silently again.
//
//   npm run -w @lms/db test:seed          (CI: .github/workflows/bdd.yml)
//
// Requirements: DATABASE_URL (its SERVER is used; the db name is swapped for
// a scratch one) and permission to CREATE/DROP DATABASE — true for local
// trust-auth Postgres and the CI postgres user. Falls back to the repo-root
// .env when DATABASE_URL is not exported.
import { execFileSync } from "child_process";
import { strict as assert } from "assert";
import * as fs from "fs";
import * as path from "path";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const PKG_ROOT = path.resolve(__dirname, "..");
const TSNODE = require.resolve("ts-node/dist/bin.js", { paths: [PKG_ROOT] });
const PRISMA = require.resolve("prisma/build/index.js", { paths: [PKG_ROOT] });
const CHECK_DB = "lms_seed_provisioning_check";

const DEMO = { email: "admin@example.com", password: "admin123" };
// Mixed-case on purpose: the seed must store it lowercased (admin login
// lower-cases the email before the unique lookup).
const OWNER_ENV_EMAIL = "Owner@Client.test";
const OWNER = { email: "owner@client.test", password: "Ownr-P4ss-b64url" };

function baseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envFile = path.resolve(PKG_ROOT, "../../.env");
  if (fs.existsSync(envFile)) {
    const m = fs
      .readFileSync(envFile, "utf8")
      .match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?\s*$/m);
    if (m) return m[1];
  }
  throw new Error("DATABASE_URL is not set (env or repo-root .env)");
}

function withDb(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

const BASE = baseUrl();
const CHECK_URL = withDb(BASE, CHECK_DB);

// The check's own media dir, like its own database. The seed doesn't just
// write rows — it copies artwork into MEDIA_DIR (and the baseline purge
// unlinks it), and in production every instance owns that directory. Without
// this, the scenarios share the REAL apps/api/src/media-uploads with whatever
// else is running: in CI, scenario 7's purge deleted the certificate artwork
// out from under the BDD suite's API, and three certificate scenarios failed
// on render. Scratch database + shared filesystem was an isolation lie.
const CHECK_MEDIA_DIR = fs.mkdtempSync(
  path.join(require("os").tmpdir(), "lms-seed-check-media-"),
);

// Child env: inherit, but scrub every seed knob so the dev shell can't leak
// one into a case, then apply the case's own.
function childEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of [
    "SEED_WIPE",
    "SEED_ADMIN_EMAIL",
    "SEED_ADMIN_PASSWORD",
    "SEED_DEMO_CONTENT",
    "SEED_DEMO_ONCE",
  ]) {
    delete env[k];
  }
  return {
    ...env,
    DATABASE_URL: CHECK_URL,
    MEDIA_DIR: CHECK_MEDIA_DIR,
    ...extra,
  };
}

function runSeed(extra: Record<string, string>, label: string): void {
  try {
    execFileSync(process.execPath, [TSNODE, "prisma/seed.ts"], {
      cwd: PKG_ROOT,
      env: childEnv(extra),
      stdio: "pipe",
    });
  } catch (e: any) {
    console.error(`seed run failed (${label}):`);
    console.error(String(e.stdout ?? ""));
    console.error(String(e.stderr ?? ""));
    throw e;
  }
  console.log(`  seeded: ${label}`);
}

function runSeedExpectFailure(extra: Record<string, string>): string {
  try {
    execFileSync(process.execPath, [TSNODE, "prisma/seed.ts"], {
      cwd: PKG_ROOT,
      env: childEnv(extra),
      stdio: "pipe",
    });
  } catch (e: any) {
    return String(e.stdout ?? "") + String(e.stderr ?? "");
  }
  throw new Error("seed unexpectedly succeeded");
}

function migrate(): void {
  execFileSync(
    process.execPath,
    [PRISMA, "migrate", "deploy", "--schema", "prisma/schema.prisma"],
    { cwd: PKG_ROOT, env: childEnv({}), stdio: "pipe" },
  );
}

async function recreateDb(): Promise<void> {
  const maint = new PrismaClient({ datasourceUrl: withDb(BASE, "postgres") });
  try {
    await maint.$executeRawUnsafe(
      `DROP DATABASE IF EXISTS ${CHECK_DB} WITH (FORCE)`,
    );
    await maint.$executeRawUnsafe(`CREATE DATABASE ${CHECK_DB}`);
  } finally {
    await maint.$disconnect();
  }
}

async function dropDb(): Promise<void> {
  const maint = new PrismaClient({ datasourceUrl: withDb(BASE, "postgres") });
  try {
    await maint.$executeRawUnsafe(
      `DROP DATABASE IF EXISTS ${CHECK_DB} WITH (FORCE)`,
    );
  } finally {
    await maint.$disconnect();
  }
}

async function main() {
  console.log(`Scratch database: ${CHECK_DB} (server from DATABASE_URL)`);
  await recreateDb();
  migrate();
  let db = new PrismaClient({ datasourceUrl: CHECK_URL });

  try {
    // ----- 1. Dev/CI mode (no env): demo admin + demo content, the contract
    // the BDD suite and local dev depend on.
    runSeed({}, "dev mode (no SEED_* env)");
    {
      const demo = await db.admin.findUnique({ where: { email: DEMO.email } });
      assert.ok(demo, "dev mode must create admin@example.com");
      assert.equal(demo.role, "SUPER_ADMIN");
      assert.ok(await bcrypt.compare(DEMO.password, demo.passwordHash));
      assert.ok((await db.level.count()) > 0, "dev mode must seed the catalog");
      assert.ok(
        await db.user.findUnique({ where: { email: "member@example.com" } }),
        "dev mode must seed the demo member",
      );
    }
    console.log("PASS  dev mode defaults (admin@example.com + demo content)");

    // ----- 2. A live instance seeded by a PRE-FIX image (state after step 1:
    // admin@example.com/admin123 only) upgrades and restarts with SEED_ADMIN_*
    // + demo content: the owner must be created and disclosed creds must work;
    // the well-known demo admin must stop accepting admin123.
    runSeed(
      {
        SEED_ADMIN_EMAIL: OWNER_ENV_EMAIL,
        SEED_ADMIN_PASSWORD: OWNER.password,
        SEED_DEMO_CONTENT: "true",
      },
      "provisioned demo instance (heals pre-fix state)",
    );
    {
      const owner = await db.admin.findUnique({
        where: { email: OWNER.email },
      });
      assert.ok(owner, "owner admin must exist at the LOWERCASED email");
      assert.equal(owner.role, "SUPER_ADMIN");
      assert.ok(
        await bcrypt.compare(OWNER.password, owner.passwordHash),
        "disclosed SEED_ADMIN_PASSWORD must log the owner in",
      );
      const demo = await db.admin.findUnique({ where: { email: DEMO.email } });
      assert.ok(demo, "leftover demo admin row is kept (content authorship)");
      assert.equal(
        await bcrypt.compare(DEMO.password, demo.passwordHash),
        false,
        "admin123 must NOT work on a provisioned instance",
      );
      assert.ok((await db.level.count()) > 0, "demo content must be seeded");
    }
    console.log(
      "PASS  SEED_ADMIN_* honored + demo admin neutralized (demo=true)",
    );

    // ----- 3. Container restart must never clobber an in-app password change.
    const changed = "changed-in-app-7";
    await db.admin.update({
      where: { email: OWNER.email },
      data: { passwordHash: await bcrypt.hash(changed, 10) },
    });
    runSeed(
      {
        SEED_ADMIN_EMAIL: OWNER_ENV_EMAIL,
        SEED_ADMIN_PASSWORD: OWNER.password,
        SEED_DEMO_CONTENT: "true",
      },
      "same instance, container restart",
    );
    {
      const owner = await db.admin.findUnique({
        where: { email: OWNER.email },
      });
      assert.ok(owner);
      assert.ok(
        await bcrypt.compare(changed, owner.passwordHash),
        "a password changed in the admin must survive a seed re-run",
      );
    }
    console.log("PASS  re-run keeps the owner's in-app password change");

    // ----- 4. Fresh REAL client (SEED_DEMO_CONTENT=false): exactly one admin,
    // zero content — the "boots empty" contract in deploy/instance/README.md.
    await db.$disconnect();
    await recreateDb();
    migrate();
    db = new PrismaClient({ datasourceUrl: CHECK_URL });
    runSeed(
      {
        SEED_ADMIN_EMAIL: OWNER_ENV_EMAIL,
        SEED_ADMIN_PASSWORD: OWNER.password,
        SEED_DEMO_CONTENT: "false",
      },
      "provisioned real client (demo=false)",
    );
    {
      const admins = await db.admin.findMany();
      assert.equal(admins.length, 1, "exactly one admin — the owner");
      assert.equal(admins[0].email, OWNER.email);
      assert.equal(admins[0].role, "SUPER_ADMIN");
      assert.ok(await bcrypt.compare(OWNER.password, admins[0].passwordHash));
      for (const [name, count] of Object.entries({
        level: await db.level.count(),
        course: await db.course.count(),
        user: await db.user.count(),
        post: await db.post.count(),
        page: await db.page.count(),
        appConfig: await db.appConfig.count(),
      })) {
        assert.equal(count, 0, `real client must boot empty (${name})`);
      }
      // The seed must never install payment credentials. Setting rows survive
      // SEED_WIPE and purgeDemoDebris by design, and the demo block runs only on
      // an instance's first boot — so a credential seeded here would be
      // effectively permanent, and an instance provisioned with sample content
      // and later handed to a paying client would keep taking checkouts on the
      // operator's account. Demo payment keys arrive over the control plane's
      // revocable service-token push instead (POST /instance-admin/demo-payment-keys).
      const settings = await db.setting.findMany({ select: { key: true } });
      assert.deepEqual(
        settings.map((s) => s.key).filter((k) => k.startsWith("stripe.")),
        [],
        "the seed must not write Stripe credentials into Setting",
      );
    }
    console.log("PASS  real client boots empty with the owner admin only");

    // ----- 5. Misconfiguration must fail loudly, never fall back to a
    // default password.
    const out = runSeedExpectFailure({
      SEED_ADMIN_EMAIL: OWNER_ENV_EMAIL,
      SEED_DEMO_CONTENT: "false",
    });
    assert.ok(
      out.includes("SEED_ADMIN_PASSWORD"),
      "missing SEED_ADMIN_PASSWORD must abort the seed",
    );
    console.log("PASS  SEED_ADMIN_EMAIL without password aborts");

    // ----- 6. FRESH demo instance (the bug report's exact scenario, first
    // boot on a fixed image): owner is the ONLY admin — admin@example.com is
    // never created — and demo content is authored by the owner.
    await db.$disconnect();
    await recreateDb();
    migrate();
    db = new PrismaClient({ datasourceUrl: CHECK_URL });
    runSeed(
      {
        SEED_ADMIN_EMAIL: OWNER_ENV_EMAIL,
        SEED_ADMIN_PASSWORD: OWNER.password,
        SEED_DEMO_CONTENT: "true",
      },
      "fresh provisioned demo instance",
    );
    {
      const admins = await db.admin.findMany();
      assert.equal(
        admins.length,
        1,
        "fresh demo instance must not create the demo admin at all",
      );
      assert.equal(admins[0].email, OWNER.email);
      assert.ok(await bcrypt.compare(OWNER.password, admins[0].passwordHash));
      assert.ok((await db.level.count()) > 0, "demo content must be seeded");
      const strayAuthor = await db.post.count({
        where: { authorId: { not: admins[0].id } },
      });
      assert.equal(strayAuthor, 0, "demo posts must be authored by the owner");
      // Not even a DEMO instance gets its payment keys from the seed — see the
      // note in scenario 4. The control plane pushes them after provisioning so
      // they stay revocable and per-instance.
      const settings = await db.setting.findMany({ select: { key: true } });
      assert.deepEqual(
        settings.map((s) => s.key).filter((k) => k.startsWith("stripe.")),
        [],
        "the demo seed must not write Stripe credentials into Setting either",
      );
    }
    console.log("PASS  fresh demo instance: owner is the only admin");

    // ----- 7. Demo instance CONVERTED to baseline (SEED_DEMO_CONTENT flipped
    // to false on a database that already carries the demo). This happened in
    // production: a client instance seeded with the demo in an earlier life
    // kept serving the retired catalog — and accepting the well-known
    // member@example.com/member123 login — because the baseline path deleted
    // nothing. The purge must remove every seed-authored row and NOTHING the
    // client made themselves.
    {
      const owner = await db.admin.findFirstOrThrow();
      await db.page.create({
        data: {
          // A cuid-shaped id, like every admin-created row — the purge's
          // "seed-" boundary must leave it alone.
          slug: "client-made-page",
          title: "The client's own page",
          status: "DRAFT",
          authorId: owner.id,
          data: { root: { props: {} }, content: [], zones: {} },
        },
      });
    }
    runSeed(
      {
        SEED_ADMIN_EMAIL: OWNER_ENV_EMAIL,
        SEED_ADMIN_PASSWORD: OWNER.password,
        SEED_DEMO_CONTENT: "false",
      },
      "same instance, converted to baseline (demo=false)",
    );
    {
      for (const [name, count] of Object.entries({
        level: await db.level.count(),
        course: await db.course.count(),
        lesson: await db.lesson.count(),
        post: await db.post.count(),
        popup: await db.popup.count(),
        form: await db.form.count(),
        menu: await db.menu.count(),
        header: await db.header.count(),
        certificateTemplate: await db.certificateTemplate.count(),
        footer: await db.footer.count(),
        appConfig: await db.appConfig.count(),
        seedMedia: await db.mediaAsset.count({
          where: { id: { startsWith: "seed-media-" } },
        }),
      })) {
        assert.equal(
          count,
          0,
          `baseline conversion must purge demo ${name} rows`,
        );
      }
      assert.equal(
        await db.user.findUnique({ where: { email: "member@example.com" } }),
        null,
        "the demo member (a public repo password) must not survive conversion",
      );
      const pages = await db.page.findMany();
      assert.equal(pages.length, 1, "client-authored content must survive");
      assert.equal(pages[0].slug, "client-made-page");
      const admins = await db.admin.findMany();
      assert.equal(admins.length, 1, "the owner admin must survive");
      assert.ok(await bcrypt.compare(OWNER.password, admins[0].passwordHash));
      assert.equal(
        await db.seedState.count(),
        0,
        "the purge must clear the demo-seeded marker with the demo",
      );
      // The rows' backing files must go with them — this is the check's own
      // media dir, so anything left is the purge forgetting to unlink.
      const leftover = fs
        .readdirSync(CHECK_MEDIA_DIR)
        .filter((f) => f.startsWith("seed-") || f.startsWith("demo-"));
      assert.deepEqual(leftover, [], "purged media rows must take their files");
    }
    console.log("PASS  demo→baseline conversion purges demo content only");

    // ----- 8. ONE-SHOT mode, first boot (what every provisioned instance now
    // runs — SEED_DEMO_ONCE=true is a literal in the instance compose): demo
    // must land in full and the SeedState marker must record it.
    await db.$disconnect();
    await recreateDb();
    migrate();
    db = new PrismaClient({ datasourceUrl: CHECK_URL });
    const ONCE_ENV = {
      SEED_ADMIN_EMAIL: OWNER_ENV_EMAIL,
      SEED_ADMIN_PASSWORD: OWNER.password,
      SEED_DEMO_CONTENT: "true",
      SEED_DEMO_ONCE: "true",
    };
    runSeed(ONCE_ENV, "one-shot demo instance, first boot");
    {
      assert.ok((await db.level.count()) > 0, "first boot must seed the demo");
      const state = await db.seedState.findUnique({
        where: { id: "singleton" },
      });
      assert.ok(state, "first demo landing must write the SeedState marker");
    }
    console.log(
      "PASS  one-shot first boot seeds the demo and stamps SeedState",
    );

    // ----- 9. THE BUG REPORT (Test Academy): the client deletes a seeded
    // class, changes another's cover image, rebrands the app, prunes the demo
    // blog — then the container restarts (deploy, pause/resume, crash). Every
    // one of those edits must survive the seed re-run.
    {
      await db.level.delete({ where: { id: "seed-class-cooking" } });
      await db.level.update({
        where: { id: "seed-class-music-production" },
        data: {
          name: "My Music Academy",
          imageUrl: "https://client.example/custom-cover.png",
        },
      });
      await db.appConfig.update({
        where: { id: "singleton" },
        data: { config: { title: "Client Academy", tagline: "Ours now." } },
      });
      await db.post.deleteMany({ where: { id: { startsWith: "seed-post-" } } });
    }
    runSeed(ONCE_ENV, "one-shot demo instance, container restart");
    {
      assert.equal(
        await db.level.findUnique({ where: { id: "seed-class-cooking" } }),
        null,
        "a class the client deleted must NOT be resurrected by a restart",
      );
      const music = await db.level.findUniqueOrThrow({
        where: { id: "seed-class-music-production" },
      });
      assert.equal(music.name, "My Music Academy");
      assert.equal(
        music.imageUrl,
        "https://client.example/custom-cover.png",
        "a cover image the client changed must NOT be reverted by a restart",
      );
      const cfg = (
        await db.appConfig.findUniqueOrThrow({
          where: { id: "singleton" },
        })
      ).config as { title?: string };
      assert.equal(
        cfg.title,
        "Client Academy",
        "app branding the client changed must NOT be reverted by a restart",
      );
      assert.equal(
        await db.post.count({ where: { id: { startsWith: "seed-post-" } } }),
        0,
        "demo posts the client deleted must NOT be re-seeded by a restart",
      );
    }
    console.log("PASS  one-shot restart leaves client edits untouched");

    // ----- 10. LEGACY instance (demo-seeded by an image that predates the
    // marker, so no SeedState row — the exact state of live instances at
    // rollout): the demo footprint must count as already-seeded. The first
    // post-fix boot stamps the marker and re-imposes NOTHING.
    {
      await db.seedState.deleteMany();
      await db.level.delete({
        where: { id: "seed-class-strength-and-conditioning" },
      });
    }
    runSeed(ONCE_ENV, "legacy demo instance, first post-fix boot");
    {
      assert.equal(
        await db.level.findUnique({
          where: { id: "seed-class-strength-and-conditioning" },
        }),
        null,
        "legacy footprint must be treated as seeded — nothing re-imposed",
      );
      const music = await db.level.findUniqueOrThrow({
        where: { id: "seed-class-music-production" },
      });
      assert.equal(
        music.imageUrl,
        "https://client.example/custom-cover.png",
        "legacy stamping must not touch existing rows",
      );
      assert.ok(
        await db.seedState.findUnique({ where: { id: "singleton" } }),
        "the first post-fix boot must stamp the marker",
      );
    }
    console.log("PASS  legacy demo instance stamped without re-imposing");

    // ----- 11. RECONFIGURE of a one-shot instance (upgrade, custom-domain
    // attach, provision retry). Every one of those recreates the containers
    // WITHOUT the provision-time seedDemo flag, so the boot arrives with
    // SEED_DEMO_CONTENT=false on a database whose demo content the client
    // already OWNS. That boot must not purge anything — this exact path wiped
    // the operator demo instance's whole catalog the day its custom domain was
    // attached. (Contrast scenario 7: with no SEED_DEMO_ONCE and no marker
    // semantics, flip-to-baseline still purges — dev refresh behavior.)
    const beforeReconfigure = {
      levels: await db.level.count(),
      courses: await db.course.count(),
      pages: await db.page.count(),
    };
    runSeed(
      {
        SEED_ADMIN_EMAIL: OWNER_ENV_EMAIL,
        SEED_ADMIN_PASSWORD: OWNER.password,
        SEED_DEMO_CONTENT: "false",
        SEED_DEMO_ONCE: "true",
      },
      "one-shot instance, reconfigure boot (env lost seedDemo)",
    );
    {
      assert.deepEqual(
        {
          levels: await db.level.count(),
          courses: await db.course.count(),
          pages: await db.page.count(),
        },
        beforeReconfigure,
        "a reconfigure boot (SEED_DEMO_CONTENT=false on a one-shot instance) must not delete content",
      );
      const music = await db.level.findUniqueOrThrow({
        where: { id: "seed-class-music-production" },
      });
      assert.equal(
        music.name,
        "My Music Academy",
        "client edits must survive a reconfigure boot untouched",
      );
      assert.ok(
        await db.seedState.findUnique({ where: { id: "singleton" } }),
        "the one-shot marker must survive a reconfigure boot (purge would have deleted it)",
      );
    }
    console.log("PASS  reconfigure boot leaves one-shot content untouched");

    console.log("\nSeed provisioning check: ALL PASS");
  } finally {
    await db.$disconnect();
    await dropDb();
    fs.rmSync(CHECK_MEDIA_DIR, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
