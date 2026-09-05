#!/usr/bin/env node
// CI dependency-audit gate.
//
// Fails the build when `npm audit` reports a PRODUCTION (omit=dev) advisory at
// high/critical severity that is NOT triaged in .audit-ci-allowlist.json. The
// point (GTM "dependency audit in CI"): a NEW vulnerability blocks merge, while
// the known-and-deferred ones (major upgrades, no-fix-upstream, low-risk
// transitive advisories) are listed in the allowlist with a category + reason
// and do not turn CI permanently red.
//
// Two hard rules the allowlist cannot bend: a production CRITICAL always fails
// (it is never allowlistable), and any tooling error (registry down, bad schema,
// an advisory we cannot key) fails the gate rather than passing silently.
//
// Scope is production deps only (`--omit=dev`) — that is what actually ships in
// the running apps; dev/build tooling advisories are noise for a runtime gate.
//
// Run locally:  npm run audit:ci
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ALLOW_PATH = join(ROOT, ".audit-ci-allowlist.json");
const FAIL_ON = new Set(["high", "critical"]);

const ghsaOf = (url) => (url || "").split("/").pop();

function readAllowlist() {
  try {
    const j = JSON.parse(readFileSync(ALLOW_PATH, "utf8"));
    const map = new Map();
    for (const e of j.allow || []) {
      const key = (e.ghsa || ghsaOf(e.url) || "").trim();
      if (key) map.set(key, e);
    }
    return map;
  } catch (e) {
    console.error(`[audit:ci] cannot read ${ALLOW_PATH}: ${e.message}`);
    process.exit(2);
  }
}

function runAudit() {
  // `npm audit` exits non-zero whenever any vuln exists, so we read stdout
  // regardless of exit code. Everything below FAILS SAFE (exit 2, never a silent
  // pass): a security gate that green-lights when it never actually ran is worse
  // than none.
  const r = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) {
    console.error(`[audit:ci] could not spawn npm audit: ${r.error.message}`);
    process.exit(2);
  }
  if (!r.stdout) {
    console.error(
      `[audit:ci] npm audit produced no output${r.stderr ? `:\n${r.stderr}` : ""}`,
    );
    process.exit(2);
  }
  let report;
  try {
    report = JSON.parse(r.stdout);
  } catch (e) {
    console.error(`[audit:ci] could not parse npm audit JSON: ${e.message}`);
    process.exit(2);
  }
  // When npm audit cannot reach the registry (offline, 5xx, 429, auth/proxy) it
  // prints a VALID JSON *error* object with no vulnerabilities/metadata — that
  // must not read as "clean". Likewise reject an unexpected schema (npm 6's
  // `advisories`, or a future auditReportVersion) instead of looping over an
  // empty map and passing. Positively require the v2 report shape.
  if (report && report.error) {
    const msg = report.error.summary || report.error.detail || report.message;
    console.error(
      `[audit:ci] npm audit reported an error: ${msg || "unknown"}`,
    );
    process.exit(2);
  }
  if (
    report.auditReportVersion !== 2 ||
    !report.metadata ||
    !report.metadata.vulnerabilities ||
    !report.vulnerabilities
  ) {
    console.error(
      `[audit:ci] unexpected npm audit output (auditReportVersion=${report.auditReportVersion}); expected v2 with metadata.vulnerabilities — treating as a tooling failure, not a clean audit.`,
    );
    process.exit(2);
  }
  return report;
}

const allow = readAllowlist();
const report = runAudit();
const vulns = report.vulnerabilities || {};

// Collapse to distinct advisories keyed by GHSA: many package rows share one.
// A string `via` is a dependency-chain link (the real advisory object appears on
// its source package's row), so it is correctly skipped — but a qualifying
// advisory OBJECT we cannot key by GHSA is surfaced as an offender, never
// silently dropped (fail closed on an unkeyable advisory).
const found = new Map();
for (const node of Object.values(vulns)) {
  for (const via of node.via || []) {
    if (typeof via !== "object" || !FAIL_ON.has(via.severity)) continue;
    const ghsa = via.url ? ghsaOf(via.url) : null;
    const key =
      ghsa || `unkeyed:${via.source ?? via.name ?? via.title ?? "unknown"}`;
    if (!found.has(key))
      found.set(key, {
        ghsa: key,
        keyed: Boolean(ghsa),
        url: via.url || "(no advisory url)",
        severity: via.severity,
        title: via.title || "(advisory with no GHSA url)",
        packages: new Set(),
      });
    found.get(key).packages.add(via.name);
  }
}

const offenders = [];
const matched = new Set();
for (const [key, adv] of found) {
  // A production CRITICAL is never deferrable — it always fails, even if listed
  // in the allowlist (only HIGHs may be triaged). An advisory we could not key
  // by GHSA cannot be matched against the allowlist, so it also always fails.
  if (adv.severity === "critical" || !adv.keyed) {
    offenders.push(adv);
    continue;
  }
  if (allow.has(key)) matched.add(key);
  else offenders.push(adv);
}

// Allowlist entries no longer present in the tree — warn so the file gets pruned
// after an upgrade (a stale allowlist silently weakens the gate).
const stale = [...allow.values()].filter(
  (e) => !found.has(e.ghsa || ghsaOf(e.url)),
);

const totals = report.metadata?.vulnerabilities || {};
console.log(
  `[audit:ci] production advisories — high: ${totals.high ?? "?"}, critical: ${totals.critical ?? "?"}`,
);
console.log(
  `[audit:ci] ${found.size} distinct high/critical · ${matched.size} triaged in allowlist · ${offenders.length} un-triaged`,
);

if (stale.length) {
  console.log(
    `\n[audit:ci] ⚠ ${stale.length} STALE allowlist entr${stale.length === 1 ? "y" : "ies"} (dependency upgraded — please remove):`,
  );
  for (const e of stale)
    console.log(`  - ${e.ghsa}  ${(e.packages || []).join(", ")}`);
}

if (offenders.length) {
  offenders.sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1,
  );
  console.error(
    `\n[audit:ci] ❌ ${offenders.length} un-triaged production high/critical advisor${offenders.length === 1 ? "y" : "ies"}:`,
  );
  for (const a of offenders) {
    console.error(
      `  - ${a.severity.toUpperCase()} ${a.ghsa}  ${[...a.packages].join(", ")}`,
    );
    console.error(`      ${a.title}`);
    console.error(`      ${a.url}`);
  }
  const hasCritical = offenders.some((a) => a.severity === "critical");
  console.error(
    `\nFix these by bumping the dependency. A HIGH that must be deferred can be added to ` +
      `.audit-ci-allowlist.json with a category + reason.` +
      (hasCritical
        ? ` A CRITICAL is NOT allowlistable — it must be fixed.`
        : ``),
  );
  process.exit(1);
}

console.log(
  `\n[audit:ci] ✅ no un-triaged production high/critical advisories.`,
);
process.exit(0);
