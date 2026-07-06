// Sales page — transcribed from frame 1c (public, no auth).

import Link from "next/link";
import { Icon, LogoGlyph } from "@/components/icons";

const COVER_MUSIC = "https://www.masterclass.com/course-images/attachments/QpxuNEFhJE8MsFqsiKQ11u1C";
const COVER_COOKING = "https://www.masterclass.com/course-images/attachments/ce3SwsNJRtiLU96MqFEfa3WU";
const COVER_PHOTO = "https://www.masterclass.com/course-images/attachments/DHTYrpiQ7QJediHA387veDhg";

const FEATURES = [
  {
    icon: "package" as const,
    title: "Isolated by design",
    copy:
      "Every license runs its own containers — database, media storage, and job queue included. Your data never shares a table with anyone.",
  },
  {
    icon: "credit-card" as const,
    title: "Billing built in",
    copy:
      "Stripe subscriptions, coupons, and a hosted customer portal. Your members pay you directly — we never touch your revenue.",
  },
  {
    icon: "video" as const,
    title: "Courses & live sessions",
    copy:
      "Classes, courses, video lessons with signed playback, live sessions, quizzes, and completion certificates out of the box.",
  },
  {
    icon: "smartphone" as const,
    title: "Mobile apps included",
    copy:
      "iOS and Android apps built for your brand and shipped to the stores under your name. Content and login, synced to your instance.",
  },
  {
    icon: "brush" as const,
    title: "White-label everything",
    copy: "Your logo, colors, domain, and email sender. Members see your academy — not our platform.",
  },
  {
    icon: "database" as const,
    title: "Backed up, kept current",
    copy:
      "Daily database and media backups with quarterly restore drills. Version updates roll out in waves, handled by our operators.",
  },
];

const CHECKLIST = [
  "Admin panel — classes, members, subscriptions, reports",
  "Member web — dashboard, lessons, certificates, community",
  "iOS & Android member apps, branded to you",
  "Live sessions with registration and recordings",
  "Email campaigns and contact tagging built in",
];

const TIERS: Array<{
  name: string;
  price: string;
  desc: string;
  features: string[];
  featured?: boolean;
}> = [
  {
    name: "Starter",
    price: "$99",
    desc: "For a first cohort",
    features: [
      "1 instance · your domain",
      "Up to 500 members",
      "Web only (no mobile apps)",
      "Weekly backups",
      "Community support",
    ],
  },
  {
    name: "Pro",
    price: "$249",
    desc: "For a growing academy",
    featured: true,
    features: [
      "1 instance · your domain",
      "Up to 5,000 members",
      "iOS & Android apps included",
      "Daily backups + restore drills",
      "Live sessions & certificates",
      "Priority support (4h)",
    ],
  },
  {
    name: "Scale",
    price: "$599",
    desc: "For schools & networks",
    features: [
      "Up to 3 instances",
      "Unlimited members",
      "Dedicated host & SLA 99.9%",
      "Hourly backups",
      "White-glove migration",
      "Slack support channel",
    ],
  },
];

export default function SalesPage() {
  return (
    <main className="sales page-in">
      {/* ---- ink band: nav + hero ---- */}
      <div className="sales-band" id="product">
        <nav className="sales-nav">
          <div className="sales-nav-logo">
            <LogoGlyph size={28} />
            <span className="sales-nav-name">Spotlight LMS</span>
          </div>
          <div className="sales-nav-spacer" />
          <div className="sales-nav-links">
            <a href="#product">Product</a>
            <a href="#features">Features</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
          </div>
          <Link href="/signup" className="btn btn-ghost-dark">
            Book a demo
          </Link>
          <Link href="/signup" className="btn btn-primary">
            Get your instance
          </Link>
        </nav>

        <div className="hero">
          <div className="hero-left">
            <span className="badge-pill">1 LICENSE = 1 FULLY ISOLATED INSTANCE</span>
            <h1 className="hero-h1">
              Your own academy.
              <br />
              Your own everything.
            </h1>
            <p className="hero-sub">
              One license gives you a complete learning platform — member site, admin panel, and mobile
              apps — running on <b>your domain</b> with <b>your own database</b>. No shared anything.
            </p>
            <div className="hero-ctas">
              <Link href="/signup" className="btn btn-primary btn-lg">
                Launch your academy
              </Link>
              <Link href="/portal?demo=1" className="hero-ghost">
                <Icon name="play" size={13} />
                See it live
              </Link>
            </div>
            <div className="hero-fine">Provisioned in minutes · daily backups · updates handled for you</div>
          </div>

          {/* ---- browser mock ---- */}
          <div className="bmock" aria-hidden="true">
            <div className="bmock-bar">
              <span className="bmock-dot r" />
              <span className="bmock-dot y" />
              <span className="bmock-dot g" />
              <span className="bmock-spacer" />
              <span className="bmock-url">harboryoga.com/dashboard</span>
              <span className="bmock-spacer" />
            </div>
            <div className="bmock-hero">
              <div className="bmock-hero-top">
                <LogoGlyph size={13} />
                <span className="bmock-school">Harbor Yoga School</span>
                <span className="bmock-spacer" style={{ flex: 1 }} />
                <span className="bmock-av" />
              </div>
              <div className="bmock-greet">Good evening, Maya</div>
              <div className="bmock-streak">You are 72% through your teacher training.</div>
            </div>
            <div className="bmock-body">
              <div className="bmock-card">
                <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
                  <circle cx="17" cy="17" r="13" fill="none" stroke="#eeecf5" strokeWidth="4" />
                  <circle
                    cx="17"
                    cy="17"
                    r="13"
                    fill="none"
                    stroke="#35b3a2"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeDasharray="58.8 81.7"
                    transform="rotate(-90 17 17)"
                  />
                </svg>
                <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  <span className="bmock-card-title">My Learning Overview</span>
                  <span className="bmock-card-sub">3 active courses · 12 hours this month</span>
                </span>
                <span style={{ flex: 1 }} />
                <span className="bmock-resume">Resume</span>
              </div>
              <div className="bmock-grid">
                {[
                  { base: "196,112,6", cover: COVER_MUSIC, pct: 70 },
                  { base: "112,42,163", cover: COVER_COOKING, pct: 40 },
                  { base: "42,124,72", cover: COVER_PHOTO, pct: 85 },
                ].map((c) => (
                  <div
                    key={c.cover}
                    className="bmock-class"
                    style={{
                      background: `linear-gradient(178deg, rgba(${c.base},.93) 0%, rgba(${c.base},.55) 50%, rgba(${c.base},.4) 100%), url(${c.cover}) center/cover`,
                    }}
                  >
                    <span className="bmock-class-spacer" />
                    <span className="bmock-pct">{c.pct}%</span>
                    <span className="bmock-track">
                      <span className="bmock-fill" style={{ width: `${c.pct}%` }} />
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ---- 6-card feature grid overlapping the band ---- */}
      <div className="features" id="features">
        <div className="features-grid">
          {FEATURES.map((f) => (
            <div key={f.title} className="feature-card">
              <span className="feature-icon">
                <Icon name={f.icon} size={19} />
              </span>
              <div className="feature-title">{f.title}</div>
              <div className="feature-copy">{f.copy}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ---- everything in the box ---- */}
      <div className="box-section">
        <div className="box-grid">
          <div>
            <div className="eyebrow">EVERYTHING IN THE BOX</div>
            <h2 className="box-h2">Stop stitching plugins together.</h2>
            <p className="box-sub">
              Spotlight LMS replaces the WordPress + WooCommerce + LMS-plugin stack with one product that
              already works as one.
            </p>
            <div className="box-checks">
              {CHECKLIST.map((item) => (
                <div key={item} className="check-row">
                  <span className="check-circle">
                    <Icon name="check" size={12} />
                  </span>
                  <span className="check-text">{item}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="box-visual">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={COVER_COOKING} alt="An academy lesson in progress" className="box-photo" />
            <div className="float-chip">
              <span className="float-chip-icon">
                <Icon name="award" size={16} />
              </span>
              <span style={{ display: "flex", flexDirection: "column" }}>
                <span className="float-chip-big">312 certificates</span>
                <span className="float-chip-sub">issued by one academy last quarter</span>
              </span>
            </div>
            <div className="float-chip-ink">
              <span className="float-chip-dot" />
              <span>lms_harbor · v1.8.1 · Running</span>
            </div>
          </div>
        </div>
      </div>

      {/* ---- pricing ---- */}
      <div className="pricing-section" id="pricing">
        <div className="pricing-inner">
          <div className="pricing-head">
            <div className="eyebrow">PRICING</div>
            <h2 className="pricing-h2">One license. Your whole platform.</h2>
            <p className="pricing-sub">
              Every plan is a fully isolated instance — pick the size that fits your academy.
            </p>
          </div>
          <div className="tier-grid">
            {TIERS.map((tier) => (
              <div key={tier.name} className={`tier${tier.featured ? " tier-featured" : ""}`}>
                {tier.featured && <span className="ribbon">MOST POPULAR</span>}
                <div className="tier-name">{tier.name}</div>
                <div className="tier-price-row">
                  <span className="tier-price">{tier.price}</span>
                  <span className="tier-per">/month</span>
                </div>
                <div className="tier-desc">{tier.desc}</div>
                <div className="tier-divider" />
                <div className="tier-features">
                  {tier.features.map((f) => (
                    <span key={f} className="tier-feature">
                      <Icon name="check" size={13} />
                      {f}
                    </span>
                  ))}
                </div>
                <Link href={`/signup?plan=${tier.name.toLowerCase()}`} className="tier-cta">
                  Get {tier.name}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ---- ink CTA band + footer ---- */}
      <div className="cta-band" id="faq">
        <div className="cta-inner">
          <div className="cta-copy">
            <h2 className="cta-h2">Launch your academy this week.</h2>
            <div className="cta-sub">
              Provisioning takes minutes. Migration from WordPress? We have a runbook for that.
            </div>
          </div>
          <Link href="/signup" className="btn btn-primary btn-lg">
            Get your instance
          </Link>
          <Link href="/signup" className="hero-ghost">
            Book a demo
          </Link>
        </div>
        <footer className="site-footer">
          <div className="footer-inner">
            <div className="footer-logo">
              <LogoGlyph size={16} />
              <span className="footer-name">Spotlight LMS</span>
            </div>
            <span className="footer-copy">© 2026</span>
            <div className="footer-spacer" />
            <span className="footer-links">
              <Link href="/">Docs</Link> · <Link href="/portal?demo=1">Status</Link> ·{" "}
              <Link href="/">Privacy</Link> · <Link href="/">Terms</Link> ·{" "}
              <Link href="/operator/login">Operator sign-in</Link>
            </span>
          </div>
        </footer>
      </div>
    </main>
  );
}
