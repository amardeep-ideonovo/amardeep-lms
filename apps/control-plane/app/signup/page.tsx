"use client";

// Self-serve signup — the client journey starts on the sales page and lands
// here: account → plan → PREVIEW checkout, then straight into the portal to
// provision their instance. Single page, 3 steps, Ink Hero band + overlapping
// white card. No real payment is processed anywhere in this flow.

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { clientSignUp } from "@/lib/auth";
import { findClientByEmail, PLAN_PRICE } from "@/lib/provisioner";
import type { PlanTier } from "@/lib/types";
import { Icon, LogoGlyph } from "@/components/icons";
import { Field } from "@/components/ui";

const TIERS: Array<{
  tier: PlanTier;
  desc: string;
  features: string[];
  featured?: boolean;
}> = [
  {
    tier: "Starter",
    desc: "For a first cohort",
    features: ["1 instance · your domain", "Up to 500 members", "Web only (no mobile apps)", "Weekly backups"],
  },
  {
    tier: "Pro",
    desc: "For a growing academy",
    featured: true,
    features: [
      "1 instance · your domain",
      "Up to 5,000 members",
      "iOS & Android apps included",
      "Daily backups + restore drills",
    ],
  },
  {
    tier: "Scale",
    desc: "For schools & networks",
    features: ["Up to 3 instances", "Unlimited members", "Dedicated host & SLA 99.9%", "Hourly backups"],
  },
];

const STEP_LABELS = ["Account", "Plan", "Checkout"] as const;

function planFromParam(param: string | null): PlanTier {
  if (param === "starter") return "Starter";
  if (param === "scale") return "Scale";
  return "Pro";
}

export default function SignupPage() {
  return (
    <main className="signup-page page-in">
      <div className="signup-band">
        <nav className="sales-nav">
          <Link href="/" className="sales-nav-logo">
            <LogoGlyph size={28} />
            <span className="sales-nav-name">Spotlight LMS</span>
          </Link>
          <div className="sales-nav-spacer" />
          <Link href="/login" className="btn btn-ghost-dark">
            Already have an academy? Sign in
          </Link>
        </nav>
        <div className="signup-head">
          <h1 className="signup-h1">Start your academy</h1>
          <p className="signup-sub">
            Account, plan, checkout — then your own fully isolated instance boots in minutes.
          </p>
        </div>
      </div>
      {/* useSearchParams (the ?plan= preselect) needs a Suspense boundary in static export. */}
      <Suspense fallback={<div className="signup-card skl" style={{ height: 420 }} />}>
        <SignupCard />
      </Suspense>
    </main>
  );
}

function SignupCard() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [academyName, setAcademyName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [plan, setPlan] = useState<PlanTier>(() => planFromParam(searchParams.get("plan")));
  const [cardName, setCardName] = useState("");
  const [cardNumber, setCardNumber] = useState("4242 4242 4242 4242");
  const [cardExpiry, setCardExpiry] = useState("12 / 29");
  const [cardCvc, setCardCvc] = useState("123");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);

  const price = PLAN_PRICE[plan];

  const continueFromAccount = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setDuplicate(false);
    if (!name.trim()) return setError("Tell us your name — it becomes your admin account.");
    if (!academyName.trim()) return setError("Give your academy a name — you can change it later.");
    if (!/.+@.+\..+/.test(email)) return setError("Enter a valid email — it's how you'll sign in.");
    if (!password) return setError("Pick a password (any works in the preview).");
    if (findClientByEmail(email)) {
      setDuplicate(true);
      setError("An academy is already registered to that email.");
      return;
    }
    if (!cardName) setCardName(name.trim());
    setStep(1);
  };

  const submitCheckout = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setDuplicate(false);
    setBusy(true);
    const result = await clientSignUp({
      name: name.trim(),
      academyName: academyName.trim(),
      email: email.trim(),
      password,
      plan,
    });
    if (!result.ok) {
      setBusy(false);
      setDuplicate(true);
      setError(result.error);
      return;
    }
    router.replace("/portal");
  };

  return (
    <div className="signup-card">
      <div className="wizard-steps" aria-label={`Step ${step + 1} of 3 — ${STEP_LABELS[step]}`}>
        {STEP_LABELS.map((label, idx) => (
          <span key={label} style={{ display: "contents" }}>
            {idx > 0 && <span className="wstep-line" aria-hidden="true" />}
            <span
              className={`wstep${idx === step ? " active" : ""}${idx < step ? " done" : ""}`}
              aria-current={idx === step ? "step" : undefined}
            >
              <span className="wstep-num">{idx < step ? <Icon name="check" size={11} /> : idx + 1}</span>
              {label}
            </span>
          </span>
        ))}
      </div>

      {step === 0 && (
        <form className="login-form" onSubmit={continueFromAccount}>
          <div className="wizard-two-col">
            <Field label="Your name">
              <input
                className="input"
                name="name"
                autoComplete="name"
                placeholder="Priya Sharma"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </Field>
            <Field label="Academy name" hint="Shown to your members — you can rebrand any time.">
              <input
                className="input"
                name="organization"
                autoComplete="organization"
                placeholder="Harbor Yoga School"
                value={academyName}
                onChange={(e) => setAcademyName(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Email">
            <input
              className="input"
              type="email"
              name="email"
              autoComplete="email"
              placeholder="you@youracademy.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
                setDuplicate(false);
              }}
              aria-invalid={error ? true : undefined}
            />
          </Field>
          <Field label="Password">
            <input
              className="input"
              type="password"
              name="new-password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {error && (
            <p className="form-error" role="alert">
              {error}{" "}
              {duplicate && (
                <Link href="/login" className="form-error-link">
                  Sign in instead →
                </Link>
              )}
            </p>
          )}
          <div className="wizard-actions">
            <span className="wizard-fine">Step 1 of 3 — no charge yet</span>
            <button type="submit" className="btn btn-primary" style={{ padding: "11px 22px" }}>
              Continue to plan
            </button>
          </div>
        </form>
      )}

      {step === 1 && (
        <div>
          <div className="plan-pick" role="radiogroup" aria-label="Choose a plan">
            {TIERS.map((t) => {
              const selected = plan === t.tier;
              return (
                <button
                  key={t.tier}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`plan-card${t.featured ? " featured" : ""}${selected ? " selected" : ""}`}
                  onClick={() => setPlan(t.tier)}
                >
                  {t.featured && <span className="ribbon">MOST POPULAR</span>}
                  <span className="plan-name">{t.tier}</span>
                  <span className="plan-price-row">
                    <span className="plan-price">${PLAN_PRICE[t.tier]}</span>
                    <span className="plan-per">/month</span>
                  </span>
                  <span className="plan-desc">{t.desc}</span>
                  <span className="plan-divider" />
                  <span className="plan-features">
                    {t.features.map((f) => (
                      <span key={f} className="plan-feature">
                        <Icon name="check" size={12} />
                        {f}
                      </span>
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="wizard-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setStep(0)}>
              ← Back
            </button>
            <button
              type="button"
              className="btn btn-primary"
              style={{ padding: "11px 22px" }}
              onClick={() => setStep(2)}
            >
              Continue to checkout
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <form className="login-form" onSubmit={submitCheckout}>
          <div className="preview-badge" role="note">
            <Icon name="shield" size={13} />
            Preview checkout — no real charge
          </div>
          <div className="summary-row">
            <span className="summary-plan">
              {plan} plan — {academyName.trim() || "your academy"}
            </span>
            <span className="summary-spacer" />
            <span className="summary-price">
              ${price}
              <span className="summary-per">/mo</span>
            </span>
            <button type="button" className="link-teal" onClick={() => setStep(1)}>
              Change
            </button>
          </div>
          <Field label="Name on card">
            <input
              className="input"
              autoComplete="off"
              placeholder="Name on card"
              value={cardName}
              onChange={(e) => setCardName(e.target.value)}
            />
          </Field>
          <Field label="Card number" hint="Demo card — any number, expiry and CVC are accepted.">
            <input
              className="input mono"
              autoComplete="off"
              inputMode="numeric"
              value={cardNumber}
              onChange={(e) => setCardNumber(e.target.value)}
            />
          </Field>
          <div className="wizard-two-col">
            <Field label="Expiry">
              <input
                className="input mono"
                autoComplete="off"
                inputMode="numeric"
                value={cardExpiry}
                onChange={(e) => setCardExpiry(e.target.value)}
              />
            </Field>
            <Field label="CVC">
              <input
                className="input mono"
                autoComplete="off"
                inputMode="numeric"
                maxLength={4}
                value={cardCvc}
                onChange={(e) => setCardCvc(e.target.value)}
              />
            </Field>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}{" "}
              {duplicate && (
                <Link href="/login" className="form-error-link">
                  Sign in instead →
                </Link>
              )}
            </p>
          )}
          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={busy}
            style={{ padding: "13px 16px", fontSize: 13.5 }}
          >
            {busy ? "Creating your academy…" : `Start ${plan} — $${price}/mo`}
          </button>
          <div className="wizard-actions" style={{ marginTop: 2 }}>
            <button type="button" className="btn btn-ghost" onClick={() => setStep(1)}>
              ← Back
            </button>
            <span className="wizard-fine">
              Preview build — nothing is billed. Your license is created with demo billing (Visa •••• 4242).
            </span>
          </div>
        </form>
      )}
    </div>
  );
}
