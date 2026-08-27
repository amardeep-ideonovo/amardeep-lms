// Deterministic intent routing for the member helpdesk composer.
//
// The helpdesk has NO language model and costs $0 per conversation, but a chat
// without a text box is "a website with extra steps" (NN/g) — so the composer
// is real and this is what stands behind it: a keyword match against the topics
// the bot can actually answer from the member's own account.
//
// It deliberately does the cheap, honest thing. When nothing matches we say so
// and offer to pass the message to a human, rather than guessing or looping the
// member through "I didn't understand that".
//
// Shared by web and mobile so the two surfaces answer the same sentence the
// same way. NOT imported by the API (which cannot runtime-import @lms/types
// values — see constants.ts).
import type { HelpdeskCategory } from "./index";

/** Words that point at a topic. Ordered groups; a token may only score once. */
const TOPIC_WORDS: { category: HelpdeskCategory; words: readonly string[] }[] =
  [
    {
      category: "BILLING",
      words: [
        "payment",
        "payments",
        "pay",
        "paid",
        "paying",
        "billing",
        "bill",
        "billed",
        "invoice",
        "invoices",
        "charge",
        "charged",
        "card",
        "refund",
        "refunded",
        "subscription",
        "subscribe",
        "renew",
        "renewal",
        "receipt",
        "price",
        "cost",
        "charged",
        "money",
      ],
    },
    {
      category: "ACCESS",
      words: [
        "class",
        "classes",
        "access",
        "locked",
        "lock",
        "unlock",
        "enrol",
        "enroll",
        "enrolled",
        "enrolment",
        "enrollment",
        "membership",
        "member",
        "purchased",
        "bought",
        "join",
        "joined",
      ],
    },
    {
      category: "TECHNICAL",
      words: [
        "course",
        "courses",
        "lesson",
        "lessons",
        "video",
        "videos",
        "play",
        "playing",
        "watch",
        "watching",
        "progress",
        "module",
        "modules",
        "buffering",
        "loading",
        "stuck",
        "broken",
        "error",
      ],
    },
    {
      category: "LIVE_SESSION",
      words: ["live", "session", "sessions", "zoom", "meet", "webinar"],
    },
    {
      category: "CERTIFICATE",
      words: [
        "certificate",
        "certificates",
        "cert",
        "certs",
        "diploma",
        "award",
      ],
    },
    {
      category: "ACCOUNT",
      words: [
        "account",
        "profile",
        "password",
        "email",
        "username",
        "login",
        "signin",
        "avatar",
        "photo",
      ],
    },
  ];

/** Phrases that mean "show me the tickets I already raised". Phrase-level on
 *  purpose: "request" is an ordinary verb ("I'd like to request a refund") and
 *  matching the bare token sent those members to their ticket list. */
const REQUEST_PHRASES: readonly string[] = [
  // "ticket" is unambiguous in this product (unlike the verb "request"), so the
  // bare word is safe and catches "my support ticket", "that ticket I raised".
  "ticket",
  "my ticket",
  "my tickets",
  "my request",
  "my requests",
  "my complaint",
  "my complaints",
  "open ticket",
  "existing ticket",
  "ticket status",
];

/** Unambiguous single words for "put me through to a person". Deliberately
 *  short: "support", "team" and "staff" are the product's OWN vocabulary and
 *  appear in ordinary sentences ("my support ticket"), so matching them here
 *  hijacked routing before topic scoring ever ran. */
const HUMAN_WORDS: readonly string[] = ["human", "agent", "advisor"];

/** Phrases that unambiguously ask for a person. Matched against the whole
 *  normalized message, so "talk to someone" counts but "someone said" doesn't. */
const HUMAN_PHRASES: readonly string[] = [
  "real person",
  "a person",
  "to someone",
  "with someone",
  "to a human",
  "customer service",
  "speak to",
  "talk to",
  "contact the team",
  "message the team",
];

/** Lowercased, punctuation-stripped, single-spaced — for phrase matching. */
function normalize(raw: string): string {
  return ` ${raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ")} `;
}

/** Multi-word forms that tokenising would otherwise destroy. Checked against
 *  the normalized string before token scoring — "I can't log in" is the most
 *  common support message there is and used to score nothing at all. */
const TOPIC_PHRASES: {
  category: HelpdeskCategory;
  phrases: readonly string[];
}[] = [
  {
    category: "ACCOUNT",
    phrases: [
      "log in",
      "logged in",
      "sign in",
      "signed in",
      "signing in",
      "log into",
      "e mail",
      "reset my password",
      "change my password",
    ],
  },
  {
    category: "BILLING",
    phrases: [
      "credit card",
      "debit card",
      "double charged",
      "charged twice",
      "money back",
      "next bill",
    ],
  },
  {
    category: "LIVE_SESSION",
    phrases: ["live class", "live session", "join the call"],
  },
];

function tokenize(raw: string): Set<string> {
  return new Set(
    raw
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean),
  );
}

export type HelpdeskIntent =
  /** Answerable from the member's own account — render that topic's card. */
  | { kind: "topic"; category: HelpdeskCategory }
  /** "show my requests" */
  | { kind: "requests" }
  /** An explicit ask for a human — hand straight over, no guessing. */
  | { kind: "human" }
  /** Nothing matched: offer to send the message to the team as written. */
  | { kind: "unknown" };

/**
 * Route a member's typed message.
 *
 * `answerable` is the set of categories the CALLING SURFACE can render inline
 * (web and mobile differ — mobile has no live-session card). A category we
 * recognise but cannot answer still beats "unknown": it pre-fills the ticket
 * with the right category instead of dumping the member into OTHER.
 */
export function routeHelpdeskText(
  raw: string,
  answerable: readonly HelpdeskCategory[],
): HelpdeskIntent {
  const tokens = tokenize(raw);
  if (tokens.size === 0) return { kind: "unknown" };
  const text = normalize(raw);

  // An explicit "talk to a human" wins over any topic word in the same
  // sentence: "I already read the payments page, get me a person".
  if (
    HUMAN_WORDS.some((w) => tokens.has(w)) ||
    HUMAN_PHRASES.some(
      (ph) => text.includes(` ${ph} `) || text.includes(`${ph} `),
    )
  )
    return { kind: "human" };
  if (REQUEST_PHRASES.some((ph) => text.includes(ph)))
    return { kind: "requests" };

  const best = bestCategory(tokens, text);
  if (!best) return { kind: "unknown" };
  return answerable.includes(best)
    ? { kind: "topic", category: best }
    : { kind: "unknown" };
}

/** Highest-scoring topic group, ties broken toward the MORE SPECIFIC group
 *  (the one with fewer keywords) rather than declaration order — otherwise the
 *  large BILLING list silently beat narrower topics on every 1-1 tie. */
function bestCategory(
  tokens: Set<string>,
  text?: string,
): HelpdeskCategory | null {
  // A multi-word phrase is a stronger signal than a stray token, so it wins
  // outright ("I can't log in" must be ACCOUNT even though nothing tokenises).
  if (text) {
    for (const group of TOPIC_PHRASES) {
      if (group.phrases.some((ph) => text.includes(` ${ph} `)))
        return group.category;
    }
  }
  let best: HelpdeskCategory | null = null;
  let bestScore = 0;
  let bestBreadth = Infinity;
  for (const group of TOPIC_WORDS) {
    let score = 0;
    for (const w of group.words) if (tokens.has(w)) score += 1;
    if (score === 0) continue;
    const breadth = group.words.length;
    if (score > bestScore || (score === bestScore && breadth < bestBreadth)) {
      bestScore = score;
      bestBreadth = breadth;
      best = group.category;
    }
  }
  return best;
}

/**
 * Best-effort category for a message we could not answer, so an escalated
 * ticket lands in the right bucket instead of OTHER.
 */
export function categoryForText(raw: string): HelpdeskCategory {
  return bestCategory(tokenize(raw), normalize(raw)) ?? "OTHER";
}
