"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type {
  AuthUser,
  BillingConfigDTO,
  CouponPreviewDTO,
} from "@lms/types";
import {
  ApiError,
  getBillingConfig,
  getCurrentUser,
  logout,
  paypalActivate,
  paypalPrepare,
  signup,
  subscribe,
  syncSubscriptions,
  validateCoupon,
} from "@/lib/checkout-service";
import {
  formatMoney,
  optionWireId,
  resolveCheckoutConfig,
  type CheckoutProductOption,
  type LevelCheckoutConfig,
} from "@/lib/checkout-config";
import { DEFAULT_COUNTRY } from "@/lib/countries";
import CountrySelect from "@/components/checkout/CountrySelect";
import LoginModal from "@/components/checkout/LoginModal";
import PaymentSection, {
  type PaymentHandle,
  type PayPalDriver,
} from "@/components/checkout/PaymentSection";

// Fallback when the public billing config can't be reached: Stripe mock mode
// (the page stays fully usable).
const FALLBACK_BILLING: BillingConfigDTO = {
  provider: "stripe",
  publishableKey: null,
  paypalClientId: null,
  paypalMode: null,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <div className="co-section-head">
      <span>{children}</span>
      <span className="co-rule" />
    </div>
  );
}

export default function CheckoutPage() {
  const router = useRouter();
  const params = useParams<{ levelId: string }>();
  const slugOrId = params.levelId;

  // load state
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [config, setConfig] = useState<LevelCheckoutConfig | null>(null);
  const [billing, setBilling] = useState<BillingConfigDTO>(FALLBACK_BILLING);

  // auth
  const [user, setUser] = useState<AuthUser | null>(null);
  const [showLogin, setShowLogin] = useState(false);

  // form
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [country, setCountry] = useState(DEFAULT_COUNTRY);
  const [address, setAddress] = useState("");

  // coupon
  const [coupon, setCoupon] = useState("");
  const [couponBusy, setCouponBusy] = useState(false);
  const [couponPreview, setCouponPreview] = useState<CouponPreviewDTO | null>(
    null,
  );

  // submit
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);

  const payRef = useRef<PaymentHandle>(null);
  // Re-entry guard: `setSubmitting(true)` doesn't disable the button until React
  // re-renders, so a fast second click could fire onSubmit (and create a second
  // subscription) before that. This ref flips synchronously, closing that gap.
  const submittingRef = useRef(false);
  const provider = billing.provider;
  const mockMode =
    provider === "paypal" ? !billing.paypalClientId : !billing.publishableKey;

  // Prefill identity from the signed-in profile (State B). Kept editable.
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
    (async () => {
      try {
        const [u, cfg, resolved] = await Promise.all([
          getCurrentUser(),
          // billing config is best-effort; default to mock if it fails.
          getBillingConfig().catch(() => FALLBACK_BILLING),
          // public — resolves by slug or raw id, works logged-out.
          resolveCheckoutConfig(slugOrId),
        ]);
        if (!active) return;
        setBilling(cfg);
        applyUser(u);
        setConfig(resolved);
        if (resolved && resolved.options.length > 0) {
          setSelectedKey(resolved.options[0].key);
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slugOrId]);

  const selected: CheckoutProductOption | null = useMemo(
    () => config?.options.find((o) => o.key === selectedKey) ?? null,
    [config, selectedKey],
  );

  // Reset a validated coupon when the product changes (discount is price-bound).
  useEffect(() => {
    setCouponPreview(null);
  }, [selectedKey]);

  const total = useMemo(() => {
    if (!selected) return 0;
    if (couponPreview?.valid && couponPreview.amountOff != null) {
      return Math.max(0, selected.amount - couponPreview.amountOff);
    }
    return selected.amount;
  }, [selected, couponPreview]);

  async function applyCoupon() {
    const code = coupon.trim();
    if (!code || !selected) return;
    setCouponBusy(true);
    try {
      if (mockMode) {
        // No Stripe to validate against locally — accept optimistically.
        setCouponPreview({
          valid: true,
          code,
          label: "Will apply at payment",
          amountOff: null,
          percentOff: null,
          message: null,
        });
      } else {
        const wireId = optionWireId(selected);
        if (!wireId) throw new ApiError(404, "Plan not found");
        const preview = await validateCoupon(code, wireId);
        setCouponPreview(preview);
      }
    } catch (err) {
      setCouponPreview({
        valid: false,
        code,
        label: null,
        amountOff: null,
        percentOff: null,
        message: err instanceof ApiError ? err.message : "Could not validate.",
      });
    } finally {
      setCouponBusy(false);
    }
  }

  function validate(): string | null {
    if (!selected) return "Please choose a product option.";
    if (!EMAIL_RE.test(email.trim())) return "Enter a valid email address.";
    if (!user) {
      if (password.length < MIN_PASSWORD)
        return `Password must be at least ${MIN_PASSWORD} characters.`;
    }
    if (!firstName.trim()) return "Enter your first name.";
    if (!lastName.trim()) return "Enter your last name.";
    if (!country) return "Select your country or region.";
    return null;
  }

  // Ensure an authenticated member (guests sign up inline with the form's
  // email + password). Returns null when aborted — an existing email opens the
  // login modal instead. Shared by the Submit flow and the PayPal Buttons.
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

  // PayPal approved the subscription in the popup — verify it server-side
  // (which grants access inline) and land on the thank-you page.
  async function completePayPal(subscriptionId: string) {
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await paypalActivate(subscriptionId);
      router.push(
        `/checkout/thank-you?class=${encodeURIComponent(config?.heading ?? "")}`,
      );
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "We couldn’t confirm your PayPal subscription. Please contact support.",
      );
      setSubmitting(false);
      submittingRef.current = false;
    }
  }

  // Mock PayPal path (no client id configured): validate + account, simulate.
  async function mockPayPalPay() {
    setError(null);
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const current = await ensureAccount();
      if (!current) {
        setSubmitting(false);
        submittingRef.current = false;
        return;
      }
      await new Promise((r) => setTimeout(r, 600)); // simulate the popup
      router.push(
        `/checkout/thank-you?class=${encodeURIComponent(config?.heading ?? "")}`,
      );
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Something went wrong. Please try again.",
      );
      setSubmitting(false);
      submittingRef.current = false;
    }
  }

  // Handlers the PayPal Buttons call (PaymentSection reads these through a
  // ref, so fresh state is always visible).
  const paypalDriver: PayPalDriver = {
    validate,
    createSubscription: async () => {
      setError(null);
      const current = await ensureAccount();
      if (!current) throw new Error("Sign in to continue.");
      const wireId = selected ? optionWireId(selected) : null;
      if (!wireId) {
        throw new Error("This plan isn’t available for PayPal checkout yet.");
      }
      const prepared = await paypalPrepare(wireId);
      return { planId: prepared.planId, customId: prepared.customId };
    },
    onApproved: (subscriptionId) => {
      void completePayPal(subscriptionId);
    },
    onError: (message) => {
      setError(message);
      setSubmitting(false);
      submittingRef.current = false;
    },
    onMockPay: () => {
      void mockPayPalPay();
    },
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    if (!selected) return;
    if (submittingRef.current) return; // ignore a double submit (see ref above)
    submittingRef.current = true;
    setSubmitting(true);
    try {
      // 1) Ensure an authenticated member (State A signs up inline).
      const current = await ensureAccount();
      if (!current) {
        setSubmitting(false);
        submittingRef.current = false;
        return;
      }

      // 2) Pay. Recurring + real Stripe → server PaymentIntent then confirm.
      //    One-time ("Pay in Full") and any mock environment → simulated confirm.
      const useRealStripe = !mockMode && selected.kind === "recurring";
      let clientSecret: string | null = null;
      if (useRealStripe) {
        const wireId = optionWireId(selected);
        if (!wireId) {
          setError("This plan isn’t configured for checkout yet.");
          setSubmitting(false);
          submittingRef.current = false;
          return;
        }
        const res = await subscribe({
          priceId: wireId,
          couponCode: couponPreview?.valid ? coupon.trim() : undefined,
        });
        if (res.status === "active") {
          // Already paid (e.g. a 100%-off coupon) — reconcile inline, then go.
          try {
            await syncSubscriptions();
          } catch {
            // best-effort; the Stripe webhook reconciles too
          }
          router.push(
            `/checkout/thank-you?class=${encodeURIComponent(config?.heading ?? "")}`,
          );
          return;
        }
        clientSecret = res.clientSecret;
      }

      const payErr = await payRef.current?.confirm(clientSecret);
      if (payErr) {
        setError(payErr);
        setSubmitting(false);
        submittingRef.current = false;
        return;
      }

      // 3) Enrolled. Reconcile the grant inline so access + the admin
      //    notification reflect immediately (the webhook also does this in prod).
      try {
        await syncSubscriptions();
      } catch {
        // best-effort; the Stripe webhook reconciles too
      }
      router.push(
        `/checkout/thank-you?class=${encodeURIComponent(config?.heading ?? "")}`,
      );
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Something went wrong. Please try again.",
      );
      setSubmitting(false);
      submittingRef.current = false;
    }
  }

  if (loading) {
    return (
      <div className="dark-page checkout-dark">
        <div className="dp-wrap">
          <div className="centered-state">
            <div className="spinner" aria-label="Loading" />
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
          We couldn’t find a plan for “{slugOrId}”. The link may be out of date.
        </p>
        <Link href="/pricing/all" className="btn btn-primary press">
          View all plans
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
        {/* SELECT PRODUCT */}
        <SectionHead>SELECT PRODUCT</SectionHead>
        <div className="co-products">
          {config.options.map((opt) => {
            const active = opt.key === selectedKey;
            return (
              <label
                key={opt.key}
                className={`co-product${active ? " co-product--active" : ""}`}
              >
                <span
                  className={`co-radio${active ? " co-radio--on" : ""}`}
                  aria-hidden
                />
                <input
                  type="radio"
                  name="product"
                  className="co-sr-only"
                  checked={active}
                  onChange={() => setSelectedKey(opt.key)}
                />
                <span className="co-product-main">
                  <span className="co-product-title">{opt.title}</span>
                  <span className="co-product-sub">{opt.subLabel}</span>
                </span>
                <span className="co-product-price">{opt.priceText}</span>
              </label>
            );
          })}
        </div>

        {/* Email + (conditional) Password */}
        <input
          className="co-input"
          type="email"
          placeholder="Email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-label="Email"
        />
        {!user && (
          <input
            className="co-input"
            type="password"
            placeholder={`Password (${MIN_PASSWORD}+ characters)`}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-label="Password"
          />
        )}

        {/* BILLING INFORMATION */}
        <SectionHead>BILLING INFORMATION</SectionHead>
        <div className="co-grid2">
          <input
            className="co-input"
            placeholder="First name"
            autoComplete="given-name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            aria-label="First name"
          />
          <input
            className="co-input"
            placeholder="Last name"
            autoComplete="family-name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            aria-label="Last name"
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
        <PaymentSection
          ref={payRef}
          provider={provider}
          publishableKey={billing.publishableKey}
          paypalClientId={billing.paypalClientId}
          paypal={provider === "paypal" ? paypalDriver : undefined}
        />

        {/* Coupon — Stripe promotion codes only; PayPal has no coupon engine. */}
        {provider !== "paypal" && (
          <>
            <div className="co-coupon">
              <input
                className="co-input"
                placeholder="Discount code"
                value={coupon}
                onChange={(e) => setCoupon(e.target.value)}
                aria-label="Discount code"
              />
              <button
                type="button"
                className="co-btn co-btn--ghost"
                onClick={applyCoupon}
                disabled={couponBusy || !coupon.trim()}
              >
                {couponBusy ? "Applying…" : "Apply"}
              </button>
            </div>
            {couponPreview && (
              <p
                className={
                  couponPreview.valid ? "co-coupon-ok" : "co-coupon-bad"
                }
              >
                {couponPreview.valid
                  ? `Coupon “${couponPreview.code}” applied${couponPreview.label ? ` — ${couponPreview.label}` : ""}.`
                  : couponPreview.message || "Invalid code."}
              </p>
            )}
          </>
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
              {summaryOpen ? "Hide details" : "For more details, fill the form"}
            </span>
            <span className="co-chevron hover-pop" aria-hidden>
              {summaryOpen ? "▴" : "▾"}
            </span>
          </button>
          {summaryOpen && (
            <div className="co-summary-body">
              <div className="co-summary-row">
                <span>{selected.title}</span>
                <span>{formatMoney(selected.amount, selected.currency)}</span>
              </div>
              {couponPreview?.valid && couponPreview.amountOff != null && (
                <div className="co-summary-row co-summary-row--muted">
                  <span>Discount ({couponPreview.code})</span>
                  <span>
                    −{formatMoney(couponPreview.amountOff, selected.currency)}
                  </span>
                </div>
              )}
              <div className="co-summary-row co-summary-row--total">
                <span>Total due today</span>
                <span>{formatMoney(total, selected.currency)}</span>
              </div>
            </div>
          )}
        </div>

        {error && <div className="co-alert co-alert-error">{error}</div>}

        {provider === "paypal" ? (
          <>
            {submitting && (
              <div className="co-alert">Confirming your subscription…</div>
            )}
            <p className="co-footer-note">
              Complete your purchase with the PayPal button above.
            </p>
          </>
        ) : (
          <button
            type="submit"
            className="co-btn co-btn--navy co-btn--block co-submit press"
            disabled={submitting}
          >
            {submitting ? "Processing…" : "Submit"}
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
