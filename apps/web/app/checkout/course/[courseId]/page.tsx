"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type { AuthUser, BillingConfigDTO } from "@lms/types";
import { PASSWORD_MIN, STR } from "@lms/types";
import {
  ApiError,
  confirmCourseIntent,
  createCourseIntent,
  getBillingConfig,
  getCurrentUser,
  logout,
  signup,
} from "@/lib/checkout-service";
import {
  formatMoney,
  resolveCourseCheckoutConfig,
  type CheckoutProductOption,
  type CourseCheckoutConfig,
} from "@/lib/checkout-config";
import { DEFAULT_COUNTRY } from "@/lib/countries";
import CountrySelect from "@/components/checkout/CountrySelect";
import LoginModal from "@/components/checkout/LoginModal";
import PaymentSection, {
  type PaymentHandle,
} from "@/components/checkout/PaymentSection";

// Fallback when the public billing config can't be reached: Stripe mock mode
// (the page stays fully usable in dev without keys).
const FALLBACK_BILLING: BillingConfigDTO = {
  provider: "stripe",
  publishableKey: null,
  paypalClientId: null,
  paypalMode: null,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = PASSWORD_MIN.member;

const SUBMIT_STAGE_LABELS = {
  account: "Setting up your account…",
  paying: "Confirming payment…",
  activating: "Activating your access…",
} as const;

function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <div className="co-section-head">
      <span>{children}</span>
      <span className="co-rule" />
    </div>
  );
}

// One-off course checkout — the site's OWN branded card checkout for a one-time
// LIFETIME course purchase. Mirrors the level checkout page but strips it to the
// single-option, Stripe-card, one-time PaymentIntent path (no plans, no coupons,
// no PayPal in phase 1).
export default function CourseCheckoutPage() {
  const router = useRouter();
  const params = useParams<{ courseId: string }>();
  const idOrSlug = params.courseId;

  // load state
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [config, setConfig] = useState<CourseCheckoutConfig | null>(null);
  const [billing, setBilling] = useState<BillingConfigDTO>(FALLBACK_BILLING);

  // auth
  const [user, setUser] = useState<AuthUser | null>(null);
  const [showLogin, setShowLogin] = useState(false);

  // form
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [country, setCountry] = useState(DEFAULT_COUNTRY);
  const [address, setAddress] = useState("");

  // submit
  const [submitting, setSubmitting] = useState(false);
  const [stage, setStage] = useState<
    null | "account" | "paying" | "activating"
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);

  const payRef = useRef<PaymentHandle>(null);
  // Re-entry guard: setSubmitting(true) doesn't disable the button until React
  // re-renders, so a fast second click could fire onSubmit (and mint a second
  // PaymentIntent) before that. This ref flips synchronously, closing that gap.
  const submittingRef = useRef(false);
  // Course one-off is card-only (phase 1) — always Stripe, regardless of the
  // instance's active provider. Mock mode when no Stripe publishable key.
  const mockMode = !billing.publishableKey;
  // A live instance with no Stripe gateway would otherwise fall into the mock
  // flow, which fakes success without charging or granting — misleading to a
  // real member. In a production build we block the purchase and say so. Local
  // dev keeps mock mode so the flow stays testable (NODE_ENV="development").
  const paymentsUnavailable = mockMode && process.env.NODE_ENV === "production";

  // The single one-time option (there's exactly one for a course).
  const selected: CheckoutProductOption | null = useMemo(
    () => config?.options[0] ?? null,
    [config],
  );

  // Prefill identity from the signed-in profile. Kept editable.
  function applyUser(u: AuthUser | null) {
    setUser(u);
    if (u) {
      setEmail(u.email);
      setFirstName(u.firstName ?? "");
      setLastName(u.lastName ?? "");
    }
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [u, cfg, resolved] = await Promise.all([
          getCurrentUser(),
          getBillingConfig().catch(() => FALLBACK_BILLING),
          resolveCourseCheckoutConfig(idOrSlug),
        ]);
        if (!active) return;
        setBilling(cfg);
        applyUser(u);
        setConfig(resolved);
      } catch (err) {
        if (active)
          setLoadError(
            err instanceof Error ? err.message : "Failed to load checkout.",
          );
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [idOrSlug]);

  function validate(): string | null {
    if (!selected) return "This course isn’t available for purchase.";
    if (!EMAIL_RE.test(email.trim())) return "Enter a valid email address.";
    if (!user) {
      if (password.length < MIN_PASSWORD)
        return STR.validation.passwordMin(MIN_PASSWORD);
    }
    if (!firstName.trim()) return "Enter your first name.";
    if (!lastName.trim()) return "Enter your last name.";
    if (!country) return "Select your country or region.";
    return null;
  }

  // Ensure an authenticated member (guests sign up inline with the form's email
  // + password). Returns null when aborted — an existing email opens the login
  // modal instead.
  async function ensureAccount(): Promise<AuthUser | null> {
    if (user) return user;
    try {
      const created = await signup({
        email: email.trim(),
        password,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      });
      applyUser(created);
      return created;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError(
          "An account with this email already exists — use “Already a member?” to log in.",
        );
        setShowLogin(true);
        return null;
      }
      throw err;
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (paymentsUnavailable) return; // no gateway on a live instance
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    if (!config || !selected) return;
    if (submittingRef.current) return; // ignore a double submit (see ref above)
    submittingRef.current = true;
    setSubmitting(true);
    setStage("account");
    try {
      // 1) Ensure an authenticated member (guests sign up inline).
      const current = await ensureAccount();
      if (!current) {
        setSubmitting(false);
        setStage(null);
        submittingRef.current = false;
        return;
      }
      setStage("paying");

      // 2) Pay. Real Stripe → server mints a one-time PaymentIntent, then confirm
      //    the card client-side. Mock/dev → simulated confirm (no real charge).
      let clientSecret: string | null = null;
      let paymentIntentId: string | null = null;
      if (!mockMode) {
        const res = await createCourseIntent(config.courseId);
        if (res.status === "paid") {
          // Server already fully settled (defensive — not expected for a one-off).
          setStage("activating");
          router.push(
            `/checkout/thank-you?class=${encodeURIComponent(config.heading)}`,
          );
          return;
        }
        clientSecret = res.clientSecret;
        paymentIntentId = res.paymentIntentId;
      }

      const payErr = await payRef.current?.confirm(clientSecret);
      if (payErr) {
        setError(payErr);
        setSubmitting(false);
        setStage(null);
        submittingRef.current = false;
        return;
      }

      // 3) Purchased. Grant inline so access + the admin notification reflect
      //    immediately; the payment_intent.succeeded webhook is the backstop, so
      //    a failure here never blocks the member reaching their course.
      setStage("activating");
      if (paymentIntentId) {
        try {
          await confirmCourseIntent(paymentIntentId);
        } catch {
          // best-effort; the Stripe webhook grants too
        }
      }
      router.push(
        `/checkout/thank-you?class=${encodeURIComponent(config.heading)}`,
      );
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : STR.errors.generic,
      );
      setSubmitting(false);
      setStage(null);
      submittingRef.current = false;
    }
  }

  if (loading) {
    return (
      <div className="dark-page checkout-dark">
        <div className="dp-wrap">
          <div className="centered-state">
            <div className="spinner" aria-label={STR.common.loadingLabel} />
          </div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="dark-page checkout-dark">
        <div className="dp-wrap">
          <div className="alert alert-error">{loadError}</div>
        </div>
      </div>
    );
  }

  if (!config || !selected) {
    return (
      <div className="dark-page checkout-dark">
        <div className="dp-wrap">
          <div className="co-notfound">
            <h1 className="page-title">Checkout not found</h1>
            <p className="page-sub">
              We couldn’t find a purchasable course for “{idOrSlug}”. The link
              may be out of date, or the course isn’t on sale.
            </p>
            <Link href="/dashboard" className="btn btn-primary press">
              Back to dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dark-page checkout-dark">
      <div className="dp-wrap">
        <div className="co-page">
          {/* Auth banner */}
          {user ? (
            <div className="co-auth-banner">
              <span>
                Logged in as <strong>{user.email}</strong>
              </span>
              <button
                type="button"
                className="co-linkbtn"
                onClick={() => {
                  logout();
                  applyUser(null);
                  setPassword("");
                }}
              >
                Log out
              </button>
            </div>
          ) : (
            <div className="co-auth-banner co-auth-banner--ghost">
              <span>Already have an account?</span>
              <button
                type="button"
                className="co-linkbtn"
                onClick={() => setShowLogin(true)}
              >
                Already a member?
              </button>
            </div>
          )}

          <form onSubmit={onSubmit} noValidate>
            {/* YOUR COURSE — the single one-time purchase */}
            <SectionHead>YOUR COURSE</SectionHead>
            <div className="co-products">
              <div className="co-product co-product--active">
                <span className="co-product-main">
                  <span className="co-product-title">{selected.title}</span>
                  <span className="co-product-sub">{selected.subLabel}</span>
                </span>
                <span className="co-product-price">{selected.priceText}</span>
              </div>
            </div>

            {/* Email + (conditional) Password */}
            <input
              className="co-input"
              type="email"
              placeholder={STR.labels.email}
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-label={STR.labels.email}
            />
            {!user && (
              <input
                className="co-input"
                type="password"
                placeholder={`Password (${MIN_PASSWORD}+ characters)`}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-label={STR.labels.password}
              />
            )}

            {/* BILLING INFORMATION */}
            <SectionHead>BILLING INFORMATION</SectionHead>
            <div className="co-grid2">
              <input
                className="co-input"
                placeholder={STR.labels.firstName}
                autoComplete="given-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                aria-label={STR.labels.firstName}
              />
              <input
                className="co-input"
                placeholder={STR.labels.lastName}
                autoComplete="family-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                aria-label={STR.labels.lastName}
              />
            </div>
            <CountrySelect value={country} onChange={setCountry} />
            <input
              className="co-input"
              placeholder="Address"
              autoComplete="street-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              aria-label="Address"
            />

            {/* PAYMENT INFORMATION */}
            <SectionHead>PAYMENT INFORMATION</SectionHead>
            {paymentsUnavailable ? (
              <div className="co-alert" role="status">
                Online payments aren’t available for this course yet — the site
                owner hasn’t finished setting up a payment method. Please check
                back soon.
              </div>
            ) : (
              <PaymentSection
                ref={payRef}
                provider="stripe"
                publishableKey={billing.publishableKey}
                paypalClientId={null}
              />
            )}

            {/* Summary (collapsible) */}
            <div className="co-summary">
              <button
                type="button"
                className="co-summary-head"
                onClick={() => setSummaryOpen((s) => !s)}
                aria-expanded={summaryOpen}
              >
                <span className="co-summary-title">🛒 Summary</span>
                <span className="co-summary-hint">
                  {summaryOpen ? "Hide details" : "For more details, tap here"}
                </span>
                <span className="co-chevron hover-pop" aria-hidden>
                  {summaryOpen ? "▴" : "▾"}
                </span>
              </button>
              {summaryOpen && (
                <div className="co-summary-body">
                  <div className="co-summary-row">
                    <span>{selected.title}</span>
                    <span>
                      {formatMoney(selected.amount, selected.currency)}
                    </span>
                  </div>
                  <div className="co-summary-row co-summary-row--total">
                    <span>Total due today</span>
                    <span>
                      {formatMoney(selected.amount, selected.currency)}
                    </span>
                  </div>
                  <p className="co-summary-row co-summary-row--muted">
                    <span>
                      One-time payment — lifetime access. No renewals.
                    </span>
                  </p>
                </div>
              )}
            </div>

            {error && <div className="co-alert co-alert-error">{error}</div>}

            {paymentsUnavailable ? (
              <button
                type="button"
                className="co-btn co-btn--navy co-btn--block co-submit"
                disabled
                aria-disabled="true"
                title="Online payments aren’t available for this course yet."
              >
                Payments unavailable
              </button>
            ) : (
              <button
                type="submit"
                className="co-btn co-btn--navy co-btn--block co-submit press"
                disabled={submitting}
                aria-busy={submitting}
              >
                {submitting
                  ? SUBMIT_STAGE_LABELS[stage ?? "account"]
                  : "Buy course"}
              </button>
            )}
            <p className="co-footer-note">
              We Never Share Your Information With Anyone
            </p>
          </form>

          {showLogin && (
            <LoginModal
              onClose={() => setShowLogin(false)}
              onSuccess={(u) => {
                applyUser(u);
                setShowLogin(false);
                setError(null);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
