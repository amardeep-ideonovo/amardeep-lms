// QA seed for the in-house contacts + email platform.
//
// PURPOSE: populate a dedicated, isolated "QA Email Flow" audience with test
// data exercising every FIXED flow — double-opt-in confirm, unsubscribe,
// suppression, all 5 automation triggers (incl. one deferred via delayMinutes),
// every campaign cadence (ONCE/WEEKLY/MONTHLY/CRON), the due-ONCE atomic claim,
// EmailLog rows across all statuses, EmailEvent rows of every type, and a
// webhook-suppression target.
//
// SAFETY CONTRACT:
//   - FULLY ADDITIVE. Upserts only — never deletes, never wipes, no SEED_WIPE.
//   - IDEMPOTENT. Every row keys on a deterministic `qa-…` id or the model's
//     natural unique (Audience.slug, AudienceField [audienceId,tag], Contact
//     [audienceId,email], EmailTemplate.key, EmailLog.dedupeKey,
//     ScheduledEmail.dedupeKey). Re-running restores rows to spec, no dupes.
//   - All names are prefixed "QA " and all emails are @example.com / @qa.test
//     so the data is obviously test data and safe to leave in place.
//   - SMTP is intentionally unconfigured: real sends log gracefully (not-
//     configured); no mail leaves the box. We still use only test addresses.
//
// RUN (the runner the existing seed uses — ts-node, NOT tsx):
//   cd /Users/amardeepsingh/LMS/packages/db && \
//   DATABASE_URL="postgresql://amardeepsingh@localhost:5432/lms?schema=public" \
//   ../../node_modules/.bin/ts-node --compiler-options '{"module":"commonjs"}' prisma/seed-email-qa.ts
//
// This script also loads apps/api/.env so the minted confirm/unsubscribe tokens
// are signed with the SAME secret the running server verifies with (JWT_SECRET),
// making the printed URLs immediately clickable.

import * as path from "path";
import * as fs from "fs";
import { createHmac } from "crypto";
import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";

// ---------- environment ----------
// 1) Load apps/api/.env so JWT_SECRET (token signing) + DATABASE_URL match the
//    running server. dotenv NEVER overrides already-set process.env vars, so an
//    explicitly-exported DATABASE_URL (as in the recommended run command) wins.
const API_ENV = path.resolve(__dirname, "../../../apps/api/.env");
if (fs.existsSync(API_ENV)) {
  dotenv.config({ path: API_ENV });
}
// 2) Fallback to the repo-root .env for DATABASE_URL if still unset.
const ROOT_ENV = path.resolve(__dirname, "../../../.env");
if (!process.env.DATABASE_URL && fs.existsSync(ROOT_ENV)) {
  dotenv.config({ path: ROOT_ENV });
}

const prisma = new PrismaClient();

// ---------- token minting (mirrors the server crypto EXACTLY) ----------
// confirm token : base64url(`${email}\0${audienceId}`) + "." + hex HMAC over the
//                 RAW `${email}\0${audienceId}` string. SEP is a NUL byte (0x00)
//                 — the literal `const SEP = '\0';` in apps/api/src/contacts/
//                 confirm-token.util.ts (a terminal/Read renders the NUL as an
//                 invisible blank, which is why it can look like a space; an
//                 `od -c` of that line shows `'  \0  '`). VERIFIED by a parity
//                 test: tokens minted here are byte-for-byte identical to the
//                 running server's makeConfirmToken and pass verifyConfirmToken.
//                 Using a real space here produces a token the server REJECTS.
// unsub  token  : base64url(email) + "." + hex HMAC over the RAW normalized email.
// Secret precedence (both): JWT_SECRET -> SETTINGS_ENC_KEY -> 'dev-insecure-secret'
// (dev only). Sources: apps/api/src/contacts/confirm-token.util.ts &
// apps/api/src/email/unsubscribe.util.ts.
function signingSecret(): string {
  return (
    process.env.JWT_SECRET ||
    process.env.SETTINGS_ENC_KEY ||
    "dev-insecure-secret"
  );
}
function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function hmacHex(raw: string): string {
  return createHmac("sha256", signingSecret()).update(raw).digest("hex");
}
function makeConfirmToken(email: string, audienceId: string): string {
  const normalized = email.trim().toLowerCase();
  const raw = `${normalized}\0${audienceId}`; // SEP is a NUL byte (\0) — matches server `const SEP = '\0';`
  return `${b64url(Buffer.from(raw, "utf8"))}.${hmacHex(raw)}`;
}
function makeUnsubscribeToken(email: string): string {
  const normalized = email.trim().toLowerCase();
  return `${b64url(Buffer.from(normalized, "utf8"))}.${hmacHex(normalized)}`;
}

// ---------- time helpers (plain Node Date — script runs under normal node) ----------
const now = new Date();
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
const minutesFromNow = (m: number) => new Date(now.getTime() + m * 60_000);
const daysFromNow = (d: number) => new Date(now.getTime() + d * 86_400_000);
const nextMonth = () => {
  const d = new Date(now.getTime());
  d.setMonth(d.getMonth() + 1);
  return d;
};

const TZ = "America/New_York";

// ---------- constants ----------
const AUDIENCE_ID = "qa-audience-email-flow";
const NEWSLETTER_KEY = "qa-newsletter";

// Running tally for the summary print.
const counts: Record<string, number> = {};
const bump = (k: string) => (counts[k] = (counts[k] || 0) + 1);

async function main() {
  // =====================================================================
  // 1) AUDIENCE + FIELDS
  // =====================================================================
  const audience = await prisma.audience.upsert({
    where: { slug: "qa-email-flow" },
    update: { name: "QA Email Flow", isDefault: false },
    create: {
      id: AUDIENCE_ID,
      name: "QA Email Flow",
      slug: "qa-email-flow",
      isDefault: false, // never the global default — keeps QA data isolated
    },
  });
  bump("Audience");
  const audId = audience.id; // use the actual id (handles a pre-existing slug row)

  for (const f of [
    { tag: "FNAME", label: "First Name" },
    { tag: "LNAME", label: "Last Name" },
  ]) {
    await prisma.audienceField.upsert({
      where: { audienceId_tag: { audienceId: audId, tag: f.tag } },
      update: { label: f.label, type: "text", required: false },
      create: { audienceId: audId, tag: f.tag, label: f.label, type: "text" },
    });
    bump("AudienceField");
  }

  // =====================================================================
  // 2) CONTACTS (upsert on the [audienceId,email] compound unique)
  // =====================================================================
  type C = {
    email: string;
    status: "SUBSCRIBED" | "PENDING" | "UNSUBSCRIBED" | "CLEANED";
    firstName: string;
    lastName: string;
    tags: string[];
    source?: "SIGNUP" | "FORM" | "FOOTER" | "IMPORT" | "MANUAL" | "ADMIN";
    confirmedAt?: Date | null;
    unsubscribedAt?: Date | null;
    consent?: { id: string; kind: "OPTIN" | "CONFIRM" | "UNSUBSCRIBE" | "COMPLAINT" | "CLEANED"; source?: string } | null;
  };

  const contacts: C[] = [
    // --- user-facing (kept pristine; demos point at probes for mutation) ---
    {
      email: "qa-subscribed@example.com",
      status: "SUBSCRIBED",
      firstName: "Quinn",
      lastName: "Subscriber",
      tags: ["qa", "vip"],
      source: "MANUAL",
      confirmedAt: minutesAgo(60),
      consent: { id: "qa-consent-subscribed", kind: "CONFIRM", source: "admin" },
    },
    {
      // double-opt-in demo target: PENDING + confirmedAt null. The printed
      // CONFIRM url flips this PENDING -> SUBSCRIBED.
      email: "qa-pending@example.com",
      status: "PENDING",
      firstName: "Parker",
      lastName: "Pending",
      tags: ["qa"],
      source: "FOOTER",
      confirmedAt: null,
      consent: { id: "qa-consent-pending", kind: "OPTIN", source: "footer" },
    },
    {
      // suppression demo: already unsubscribed -> excluded from sends.
      email: "qa-unsubscribed@example.com",
      status: "UNSUBSCRIBED",
      firstName: "Uma",
      lastName: "Unsub",
      tags: ["qa"],
      source: "MANUAL",
      unsubscribedAt: minutesAgo(120),
      consent: { id: "qa-consent-unsub", kind: "UNSUBSCRIBE", source: "unsubscribe-link" },
    },
    {
      // suppression demo: cleaned (hard bounce/complaint) -> never mail again.
      email: "qa-cleaned@example.com",
      status: "CLEANED",
      firstName: "Cleo",
      lastName: "Cleaned",
      tags: ["qa"],
      source: "MANUAL",
      unsubscribedAt: minutesAgo(180),
      consent: { id: "qa-consent-cleaned", kind: "CLEANED", source: "bounce" },
    },
    // --- segment + weekly-campaign recipients (tagged "weekly") ---
    {
      email: "qa-weekly-1@example.com",
      status: "SUBSCRIBED",
      firstName: "Wade",
      lastName: "Weekly",
      tags: ["qa", "weekly"],
      source: "FORM",
      confirmedAt: minutesAgo(60),
      consent: { id: "qa-consent-weekly1", kind: "CONFIRM", source: "form" },
    },
    {
      email: "qa-weekly-2@example.com",
      status: "SUBSCRIBED",
      firstName: "Willa",
      lastName: "Weekly",
      tags: ["qa", "weekly"],
      source: "FORM",
      confirmedAt: minutesAgo(60),
      consent: { id: "qa-consent-weekly2", kind: "CONFIRM", source: "form" },
    },
    // --- general campaign recipients ---
    {
      email: "qa-member-1@example.com",
      status: "SUBSCRIBED",
      firstName: "Morgan",
      lastName: "One",
      tags: ["qa", "member"],
      source: "SIGNUP",
      confirmedAt: minutesAgo(60),
      consent: { id: "qa-consent-member1", kind: "CONFIRM", source: "signup" },
    },
    {
      email: "qa-member-2@example.com",
      status: "SUBSCRIBED",
      firstName: "Riley",
      lastName: "Two",
      tags: ["qa", "member"],
      source: "SIGNUP",
      confirmedAt: minutesAgo(60),
      consent: { id: "qa-consent-member2", kind: "CONFIRM", source: "signup" },
    },
    {
      email: "qa-member-3@example.com",
      status: "SUBSCRIBED",
      firstName: "Sage",
      lastName: "Three",
      tags: ["qa", "member"],
      source: "SIGNUP",
      confirmedAt: minutesAgo(60),
      consent: { id: "qa-consent-member3", kind: "CONFIRM", source: "signup" },
    },
    // --- PROBE contacts (verify-phase mutation targets; @qa.test). These are
    //     the ones the next phase actually flips, so the user-facing contacts
    //     above stay pristine across repeated verification runs. ---
    {
      email: "qa-probe-confirm@qa.test", // PENDING -> verify confirm endpoint
      status: "PENDING",
      firstName: "Probe",
      lastName: "Confirm",
      tags: ["qa", "probe"],
      source: "FOOTER",
      confirmedAt: null,
      consent: { id: "qa-consent-probe-confirm", kind: "OPTIN", source: "footer" },
    },
    {
      email: "qa-probe-unsub@qa.test", // SUBSCRIBED -> verify unsubscribe POST
      status: "SUBSCRIBED",
      firstName: "Probe",
      lastName: "Unsub",
      tags: ["qa", "probe"],
      source: "MANUAL",
      confirmedAt: minutesAgo(60),
      consent: { id: "qa-consent-probe-unsub", kind: "CONFIRM", source: "admin" },
    },
    {
      email: "qa-probe-bounce@qa.test", // SUBSCRIBED -> verify webhook hard bounce -> CLEANED
      status: "SUBSCRIBED",
      firstName: "Probe",
      lastName: "Bounce",
      tags: ["qa", "probe"],
      source: "MANUAL",
      confirmedAt: minutesAgo(60),
      consent: { id: "qa-consent-probe-bounce", kind: "CONFIRM", source: "admin" },
    },
  ];

  const contactIdByEmail: Record<string, string> = {};
  for (const c of contacts) {
    const attributes = { FNAME: c.firstName, LNAME: c.lastName };
    const row = await prisma.contact.upsert({
      where: { audienceId_email: { audienceId: audId, email: c.email } },
      update: {
        status: c.status,
        firstName: c.firstName,
        lastName: c.lastName,
        attributes,
        tags: c.tags,
        source: c.source ?? "MANUAL",
        confirmedAt: c.confirmedAt ?? null,
        unsubscribedAt: c.unsubscribedAt ?? null,
      },
      create: {
        audienceId: audId,
        email: c.email,
        status: c.status,
        firstName: c.firstName,
        lastName: c.lastName,
        attributes,
        tags: c.tags,
        source: c.source ?? "MANUAL",
        confirmedAt: c.confirmedAt ?? null,
        unsubscribedAt: c.unsubscribedAt ?? null,
      },
    });
    contactIdByEmail[c.email] = row.id;
    bump("Contact");

    // ConsentEvent trail — fixed explicit id => idempotent (no natural unique).
    if (c.consent) {
      await prisma.consentEvent.upsert({
        where: { id: c.consent.id },
        update: { contactId: row.id, kind: c.consent.kind, source: c.consent.source ?? null },
        create: {
          id: c.consent.id,
          contactId: row.id,
          kind: c.consent.kind,
          source: c.consent.source ?? null,
          ip: "127.0.0.1",
        },
      });
      bump("ConsentEvent");
    }
  }

  // =====================================================================
  // 3) SEGMENT — "QA Weekly": contacts tagged "weekly". Filter shape per schema:
  //    { status?, anyTags?, allTags?, search? }
  // =====================================================================
  await prisma.segment.upsert({
    where: { id: "qa-segment-weekly" },
    update: {
      audienceId: audId,
      name: "QA Weekly",
      filter: { status: "SUBSCRIBED", anyTags: ["weekly"] },
    },
    create: {
      id: "qa-segment-weekly",
      audienceId: audId,
      name: "QA Weekly",
      filter: { status: "SUBSCRIBED", anyTags: ["weekly"] },
    },
  });
  bump("Segment");

  // =====================================================================
  // 4) EMAIL TEMPLATE — "QA Newsletter" (key qa-newsletter). System templates
  //    like welcome auto-seed on boot; we only add this campaign template.
  // =====================================================================
  const mjml = `<mjml>
  <mj-body>
    <mj-section>
      <mj-column>
        <mj-text font-size="20px" font-weight="700">Hello {{firstName}} 👋</mj-text>
        <mj-text>This is the QA Newsletter — a test broadcast from the in-house email engine.</mj-text>
        <mj-button href="https://example.com/qa">Read more</mj-button>
        <mj-text font-size="12px" color="#888888">
          You're receiving this because you subscribed to QA Email Flow.
          <a href="{{unsubscribeUrl}}">Unsubscribe</a>
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;
  const tmpl = await prisma.emailTemplate.upsert({
    where: { key: NEWSLETTER_KEY },
    update: {
      name: "QA Newsletter",
      subject: "QA Newsletter — hi {{firstName}}",
      mjml,
      variables: ["firstName", "unsubscribeUrl"],
      category: "QA",
    },
    create: {
      key: NEWSLETTER_KEY,
      name: "QA Newsletter",
      subject: "QA Newsletter — hi {{firstName}}",
      mjml,
      variables: ["firstName", "unsubscribeUrl"],
      category: "QA",
    },
  });
  bump("EmailTemplate");
  const newsletterTemplateId = tmpl.id;

  // =====================================================================
  // 5) AUTOMATIONS — one per trigger (fixed ids => idempotent). All point at
  //    the QA Newsletter template and are active.
  //
  //    NOTE on SIGNUP: a system SIGNUP/welcome automation may already exist
  //    (boot-seeded). To avoid a double-send on signup, the QA SIGNUP
  //    automation here is created INACTIVE (active:false) — present for the
  //    admin to see, but it will not fire. The deferred-send demo lives on a
  //    DIFFERENT trigger (LESSON_COMPLETED) so it is unaffected by that.
  // =====================================================================
  const automations = [
    {
      id: "qa-auto-signup",
      name: "QA Welcome on Signup (inactive — avoids double-send with system welcome)",
      trigger: "SIGNUP" as const,
      delayMinutes: 0,
      active: false, // inactive on purpose; see note above
    },
    {
      id: "qa-auto-subscription-active",
      name: "QA Subscription Active",
      trigger: "SUBSCRIPTION_ACTIVE" as const,
      delayMinutes: 0,
      active: true,
    },
    {
      id: "qa-auto-subscription-canceled",
      name: "QA Subscription Canceled",
      trigger: "SUBSCRIPTION_CANCELED" as const,
      delayMinutes: 0,
      active: true,
    },
    {
      // *** DEFERRED automation: delayMinutes = 2. Firing this trigger enqueues
      //     a ScheduledEmail (sendAt = now + 2m) drained by the minute @Cron. ***
      id: "qa-auto-lesson-completed",
      name: "QA Lesson Completed (DEFERRED +2m via ScheduledEmail)",
      trigger: "LESSON_COMPLETED" as const,
      delayMinutes: 2,
      active: true,
    },
    {
      id: "qa-auto-certificate-issued",
      name: "QA Certificate Issued",
      trigger: "CERTIFICATE_ISSUED" as const,
      delayMinutes: 0,
      active: true,
    },
  ];
  for (const a of automations) {
    await prisma.automation.upsert({
      where: { id: a.id },
      update: {
        name: a.name,
        trigger: a.trigger,
        templateId: newsletterTemplateId,
        active: a.active,
        delayMinutes: a.delayMinutes,
      },
      create: {
        id: a.id,
        name: a.name,
        trigger: a.trigger,
        templateId: newsletterTemplateId,
        active: a.active,
        delayMinutes: a.delayMinutes,
      },
    });
    bump("Automation");
  }

  // =====================================================================
  // 6) SCHEDULED EMAILS (deferred-send demo). Drain claim: status PENDING AND
  //    sendAt <= now -> claimed PENDING->SENT by the minute @Cron.
  //    Upsert on dedupeKey (unique) for idempotency.
  // =====================================================================
  const scheduled = [
    {
      // WILL be drained on the next minute tick (sendAt in the past).
      dedupeKey: "qa-sched-due",
      to: "qa-member-1@example.com",
      contactEmail: "qa-member-1@example.com",
      sendAt: minutesAgo(1),
      vars: { firstName: "Morgan", reason: "QA due ScheduledEmail (drains next tick)" },
    },
    {
      // Stays PENDING for the user to inspect as a "scheduled" row (future send).
      dedupeKey: "qa-sched-future",
      to: "qa-member-2@example.com",
      contactEmail: "qa-member-2@example.com",
      sendAt: minutesFromNow(60),
      vars: { firstName: "Riley", reason: "QA deferred ScheduledEmail (+60m)" },
    },
  ];
  for (const s of scheduled) {
    await prisma.scheduledEmail.upsert({
      where: { dedupeKey: s.dedupeKey },
      update: {
        automationId: "qa-auto-lesson-completed",
        to: s.to,
        templateId: newsletterTemplateId,
        templateKey: NEWSLETTER_KEY,
        vars: s.vars,
        sendAt: s.sendAt,
        status: "PENDING", // reset to PENDING so a re-run re-arms the demo
        contactId: contactIdByEmail[s.contactEmail] ?? null,
        sentAt: null,
        error: null,
      },
      create: {
        automationId: "qa-auto-lesson-completed",
        to: s.to,
        templateId: newsletterTemplateId,
        templateKey: NEWSLETTER_KEY,
        vars: s.vars,
        sendAt: s.sendAt,
        status: "PENDING",
        dedupeKey: s.dedupeKey,
        contactId: contactIdByEmail[s.contactEmail] ?? null,
      },
    });
    bump("ScheduledEmail");
  }

  // =====================================================================
  // 7) CAMPAIGNS (fixed ids => idempotent). All carry explicit timezone.
  //    Claim rule (ONCE due): status SCHEDULED AND nextRunAt <= now ->
  //    atomically claimed SCHEDULED->SENDING, sentCount incremented, then SENT.
  // =====================================================================
  const campaigns = [
    {
      // DUE ONCE: claimed + sent on the next minute tick. Demonstrates the
      // atomic SCHEDULED->SENDING claim + sentCount over SUBSCRIBED recipients.
      id: "qa-campaign-once",
      name: "QA Campaign — ONCE (due now)",
      cadence: "ONCE" as const,
      status: "SCHEDULED" as const,
      runAt: minutesAgo(1),
      nextRunAt: minutesAgo(1), // <= now -> claimed
      cron: null as string | null,
      segmentId: null as string | null,
    },
    {
      // Recurring; future nextRunAt so it does NOT fire now.
      id: "qa-campaign-weekly",
      name: "QA Campaign — WEEKLY",
      cadence: "WEEKLY" as const,
      status: "SCHEDULED" as const,
      runAt: daysFromNow(7),
      nextRunAt: daysFromNow(7),
      cron: null,
      segmentId: null,
    },
    {
      id: "qa-campaign-monthly",
      name: "QA Campaign — MONTHLY",
      cadence: "MONTHLY" as const,
      status: "SCHEDULED" as const,
      runAt: nextMonth(),
      nextRunAt: nextMonth(),
      cron: null,
      segmentId: null,
    },
    {
      // CRON: 9am every Monday (America/New_York). Future nextRunAt -> idle now.
      id: "qa-campaign-cron",
      name: "QA Campaign — CRON (9am Mondays)",
      cadence: "CRON" as const,
      status: "SCHEDULED" as const,
      runAt: null,
      nextRunAt: daysFromNow(3),
      cron: "0 9 * * 1",
      segmentId: null,
    },
    {
      // Targets the QA Weekly SEGMENT. Future nextRunAt (+1d) so it does NOT
      // fire immediately — the user can trigger it by editing nextRunAt.
      id: "qa-campaign-segment",
      name: "QA Campaign — Segment target (QA Weekly)",
      cadence: "WEEKLY" as const,
      status: "SCHEDULED" as const,
      runAt: daysFromNow(1),
      nextRunAt: daysFromNow(1),
      cron: null,
      segmentId: "qa-segment-weekly",
    },
  ];
  for (const c of campaigns) {
    await prisma.campaign.upsert({
      where: { id: c.id },
      update: {
        name: c.name,
        templateId: newsletterTemplateId,
        audienceId: audId,
        segmentId: c.segmentId,
        cadence: c.cadence,
        runAt: c.runAt,
        cron: c.cron,
        timezone: TZ,
        status: c.status,
        nextRunAt: c.nextRunAt,
        // Reset run bookkeeping so a re-run re-arms the due ONCE demo.
        lastRunAt: null,
        sentCount: 0,
      },
      create: {
        id: c.id,
        name: c.name,
        templateId: newsletterTemplateId,
        audienceId: audId,
        segmentId: c.segmentId,
        cadence: c.cadence,
        runAt: c.runAt,
        cron: c.cron,
        timezone: TZ,
        status: c.status,
        nextRunAt: c.nextRunAt,
        sentCount: 0,
      },
    });
    bump("Campaign");
  }

  // =====================================================================
  // 8) EMAIL LOGS — one per EmailStatus so the admin Logs view + analytics show
  //    data. Upsert on dedupeKey (unique). providerId correlates EmailEvents.
  //    (DELIVERED is an EmailEventType, NOT an EmailStatus — never set here.)
  // =====================================================================
  const logs = [
    {
      dedupeKey: "qa-log-sent",
      to: "qa-subscribed@example.com",
      contactEmail: "qa-subscribed@example.com",
      subject: "QA Newsletter — hi Quinn",
      status: "SENT" as const,
      providerId: "qa-prov-sent",
      error: null as string | null,
      campaignId: "qa-campaign-once",
      sentAt: minutesAgo(30),
    },
    {
      dedupeKey: "qa-log-failed",
      to: "qa-unsubscribed@example.com",
      contactEmail: "qa-unsubscribed@example.com",
      subject: "QA Newsletter — hi Uma",
      status: "FAILED" as const,
      providerId: "qa-prov-failed",
      error: "suppressed", // recipient suppressed (unsubscribed) -> not sent
      campaignId: "qa-campaign-once",
      sentAt: null,
    },
    {
      dedupeKey: "qa-log-queued",
      to: "qa-member-1@example.com",
      contactEmail: "qa-member-1@example.com",
      subject: "QA Newsletter — hi Morgan",
      status: "QUEUED" as const,
      providerId: "qa-prov-queued",
      error: null,
      campaignId: "qa-campaign-once",
      sentAt: null,
    },
    {
      dedupeKey: "qa-log-bounced",
      to: "qa-bounced@example.com",
      contactEmail: null,
      subject: "QA Newsletter — hi there",
      status: "BOUNCED" as const,
      providerId: "qa-prov-bounced", // correlated to a BOUNCE EmailEvent below
      error: "hard bounce",
      campaignId: null,
      sentAt: minutesAgo(45),
    },
    {
      dedupeKey: "qa-log-complained",
      to: "qa-complained@example.com",
      contactEmail: null,
      subject: "QA Newsletter — hi there",
      status: "COMPLAINED" as const,
      providerId: "qa-prov-complained", // correlated to a COMPLAINT EmailEvent below
      error: "marked as spam",
      campaignId: null,
      sentAt: minutesAgo(50),
    },
  ];
  for (const l of logs) {
    await prisma.emailLog.upsert({
      where: { dedupeKey: l.dedupeKey },
      update: {
        to: l.to,
        contactId: l.contactEmail ? contactIdByEmail[l.contactEmail] ?? null : null,
        templateKey: NEWSLETTER_KEY,
        campaignId: l.campaignId,
        subject: l.subject,
        status: l.status,
        providerId: l.providerId,
        error: l.error,
        sentAt: l.sentAt,
      },
      create: {
        to: l.to,
        contactId: l.contactEmail ? contactIdByEmail[l.contactEmail] ?? null : null,
        templateKey: NEWSLETTER_KEY,
        campaignId: l.campaignId,
        subject: l.subject,
        status: l.status,
        providerId: l.providerId,
        error: l.error,
        dedupeKey: l.dedupeKey,
        sentAt: l.sentAt,
      },
    });
    bump("EmailLog");
  }

  // =====================================================================
  // 9) EMAIL EVENTS — one per EmailEventType, correlated by providerId to the
  //    logs above (fixed ids => idempotent; no natural unique on the model).
  // =====================================================================
  const events = [
    {
      id: "qa-event-delivered",
      providerId: "qa-prov-sent",
      type: "DELIVERED" as const,
      email: "qa-subscribed@example.com",
      meta: { smtpResponse: "250 OK", note: "QA delivered" },
    },
    {
      id: "qa-event-open",
      providerId: "qa-prov-sent",
      type: "OPEN" as const,
      email: "qa-subscribed@example.com",
      meta: { userAgent: "Mozilla/5.0 (QA)", ip: "127.0.0.1" },
    },
    {
      id: "qa-event-click",
      providerId: "qa-prov-sent",
      type: "CLICK" as const,
      email: "qa-subscribed@example.com",
      meta: { url: "https://example.com/qa", note: "QA click" },
    },
    {
      id: "qa-event-bounce",
      providerId: "qa-prov-bounced",
      type: "BOUNCE" as const,
      email: "qa-bounced@example.com",
      meta: { type: "hard", reason: "mailbox does not exist", note: "QA bounce" },
    },
    {
      id: "qa-event-complaint",
      providerId: "qa-prov-complained",
      type: "COMPLAINT" as const,
      email: "qa-complained@example.com",
      meta: { feedbackType: "abuse", note: "QA complaint" },
    },
  ];
  for (const e of events) {
    // Best-effort link to the EmailLog by providerId so emailLogId is populated.
    const log = await prisma.emailLog.findFirst({
      where: { providerId: e.providerId },
      select: { id: true },
    });
    await prisma.emailEvent.upsert({
      where: { id: e.id },
      update: {
        emailLogId: log?.id ?? null,
        providerId: e.providerId,
        type: e.type,
        email: e.email,
        meta: e.meta,
      },
      create: {
        id: e.id,
        emailLogId: log?.id ?? null,
        providerId: e.providerId,
        type: e.type,
        email: e.email,
        meta: e.meta,
      },
    });
    bump("EmailEvent");
  }

  // =====================================================================
  // HOW-TO-TEST GUIDE (tokens minted with the SAME secret the server verifies)
  // =====================================================================
  const base = "http://localhost:3000";
  const confirmToken = makeConfirmToken("qa-pending@example.com", audId);
  const unsubToken = makeUnsubscribeToken("qa-subscribed@example.com");
  const probeConfirmToken = makeConfirmToken("qa-probe-confirm@qa.test", audId);
  const probeUnsubToken = makeUnsubscribeToken("qa-probe-unsub@qa.test");
  const webhookSecret = process.env.EMAIL_WEBHOOK_SECRET; // unset in dev -> allow+warn
  const secretFlavor = process.env.JWT_SECRET
    ? "JWT_SECRET"
    : process.env.SETTINGS_ENC_KEY
    ? "SETTINGS_ENC_KEY"
    : "dev-insecure-secret (fallback)";

  const totals = Object.entries(counts)
    .map(([k, v]) => `${k}=${v}`)
    .join("  ");

  console.log(`
===== QA EMAIL FLOW — HOW TO TEST =====

Audience: "QA Email Flow"  (slug qa-email-flow, id ${audId})
Tokens signed with: ${secretFlavor}  (matches the running server)
Seeded this run: ${totals}

------------------------------------------------------------
1) DOUBLE-OPT-IN CONFIRM (PENDING -> SUBSCRIBED)
------------------------------------------------------------
User-facing target  qa-pending@example.com. Click (GET shows the page AND
confirms; idempotent):

  ${base}/contacts/confirm?token=${confirmToken}

Probe target (mutate this one in the verify phase instead):
  ${base}/contacts/confirm?token=${probeConfirmToken}

------------------------------------------------------------
2) UNSUBSCRIBE (GET = confirm page, NO mutation; POST = mutates)
------------------------------------------------------------
User-facing target  qa-subscribed@example.com:
  GET  (renders confirm page, no change):
    ${base}/unsubscribe?token=${unsubToken}
  POST (actually unsubscribes):
    curl -X POST "${base}/unsubscribe?token=${unsubToken}"

Probe target (mutate this one in the verify phase instead):
  POST "${base}/unsubscribe?token=${probeUnsubToken}"

------------------------------------------------------------
3) WEBHOOK SUPPRESSION — hard bounce -> CLEANED + EmailEvent
------------------------------------------------------------
Target  qa-probe-bounce@qa.test (a hard bounce has NO soft/transient marker).
NOTE: use a FRESH providerId here. The webhook replay-dedupes on
(providerId, type), so a providerId that already has a seeded EmailEvent (e.g.
qa-prov-bounced, which the seed pre-populates as a BOUNCE) is a no-op. We pass a
probe-specific id with no pre-seeded event so the suppression side-effect runs:
${
  webhookSecret
    ? `  (EMAIL_WEBHOOK_SECRET is configured — sending the secret header)\n  curl -X POST "${base}/email/webhook" \\\n    -H "Content-Type: application/json" \\\n    -H "Authorization: Bearer ${webhookSecret}" \\\n    -d '{"type":"bounce","email":"qa-probe-bounce@qa.test","providerId":"qa-prov-probe-bounce-live"}'`
    : `  (No EMAIL_WEBHOOK_SECRET set — in dev the webhook fails OPEN: an\n   unauthenticated POST is accepted with a warning. In prod it would 401.)\n  curl -X POST "${base}/email/webhook" \\\n    -H "Content-Type: application/json" \\\n    -d '{"type":"bounce","email":"qa-probe-bounce@qa.test","providerId":"qa-prov-probe-bounce-live"}'`
}
  Expect: contact qa-probe-bounce@qa.test -> CLEANED, a new BOUNCE EmailEvent for
  that address, and a CLEANED ConsentEvent appended. (The separately-seeded
  EmailLog qa-prov-bounced is already BOUNCED — that's the static logs-view
  fixture, distinct from this live suppression.) A complaint
  ({"type":"complaint",...}) suppresses the same way (-> COMPLAINED). A soft
  bounce ({"type":"SoftBounce",...} or {"type":"bounce","soft":true}) records the
  event but does NOT suppress.

------------------------------------------------------------
4) WATCH THE MINUTE @Cron (≈ within 1 minute)
------------------------------------------------------------
  - Campaign "QA Campaign — ONCE (due now)" (nextRunAt in the past): the
    scheduler atomically claims SCHEDULED -> SENDING, sends to the SUBSCRIBED
    contacts in the QA audience (logs not-configured since SMTP is off),
    increments sentCount, then flips to SENT (cadence ONCE).
  - ScheduledEmail "qa-sched-due" (sendAt in the past): the drain @Cron claims
    PENDING -> SENT on the next tick. "qa-sched-future" (+60m) stays PENDING.
  - The WEEKLY/MONTHLY/CRON/segment campaigns have FUTURE nextRunAt, so they
    stay SCHEDULED and idle until then (edit nextRunAt to trigger sooner).

------------------------------------------------------------
WHERE TO LOOK IN ADMIN
------------------------------------------------------------
  Contacts:  Audiences ("QA Email Flow") · Contacts (12 QA rows, all statuses)
             · Segments ("QA Weekly")
  Email:     Templates ("QA Newsletter") · Campaigns (5) · Automations (5)
             · Logs (SENT/FAILED/QUEUED/BOUNCED/COMPLAINED + open/click/bounce
               /complaint analytics)

===== END QA EMAIL FLOW GUIDE =====
`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
