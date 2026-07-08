// Guards the PROVISIONING CONTRACT of prisma/seed.ts against a THROWAWAY
// database (never the dev DB): the control plane provisions an instance with
// SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD (+ SEED_DEMO_CONTENT) and its "Admin
// login" panel discloses exactly those credentials — so the seed MUST make
// them work, in BOTH demo modes, and must keep working across container
// restarts (the instance compose re-runs the seed on every boot).
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

// Child env: inherit, but scrub every seed knob so the dev shell can't leak
// one into a case, then apply the case's own.
function childEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of [
    "SEED_WIPE",
    "SEED_ADMIN_EMAIL",
    "SEED_ADMIN_PASSWORD",
    "SEED_DEMO_CONTENT",
  ]) {
    delete env[k];
  }
  return { ...env, DATABASE_URL: CHECK_URL, ...extra };
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
    console.log("PASS  SEED_ADMIN_* honored + demo admin neutralized (demo=true)");

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
    }
    console.log("PASS  fresh demo instance: owner is the only admin");

    console.log("\nSeed provisioning check: ALL PASS");
  } finally {
    await db.$disconnect();
    await dropDb();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
