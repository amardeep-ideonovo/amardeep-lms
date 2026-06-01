"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type { AuthUser, CouponPreviewDTO } from "@lms/types";
import {
  ApiError,
  getBillingConfig,
  getCurrentUser,
  logout,
  signup,
  subscribe,
  validateCoupon,
} from "@/lib/checkout-service";
import {
  formatMoney,
  resolveCheckoutConfig,
  type CheckoutProductOption,
  type LevelCheckoutConfig,
} from "@/lib/checkout-config";
import { DEFAULT_COUNTRY } from "@/lib/countries";
import CountrySelect from "@/components/checkout/CountrySelect";
import LoginModal from "@/components/checkout/LoginModal";
import PaymentSection, {
  type PaymentHandle,
} from "@/components/checkout/PaymentSection";

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
  const [publishableKey, setPublishableKey] = useState<string | null>(null);

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
  const mockMode = !publishableKey;

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
          getBillingConfig().catch(() => ({ publishableKey: null })),
          // public — resolves by slug or raw id, works logged-out.
          resolveCheckoutConfig(slugOrId),
        ]);
        if (!active) return;
        setPublishableKey(cfg.publishableKey);
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
        const preview = await validateCoupon(code, selected.stripePriceId);
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

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    if (!selected) return;
    setSubmitting(true);
    try {
      // 1) Ensure an authenticated member (State A signs up inline).
      let current = user;
      if (!current) {
        try {
          current = await signup({
            email: email.trim(),
            password,
            firstName: firstName.trim(),
            lastName: lastName.trim(),
          });
          applyUser(current);
        } catch (err) {
          if (err instanceof ApiError && err.status === 409) {
            setError(
              "An account with this email already exists — use “Already a member?” to log in.",
            );
            setShowLogin(true);
            setSubmitting(false);
            return;
          }
          throw err;
        }
      }

      // 2) Pay. Recurring + real Stripe → server PaymentIntent then confirm.
      //    One-time ("Pay in Full") and any mock environment → simulated confirm.
      const useRealStripe = !mockMode && selected.kind === "recurring";
      let clientSecret: string | null = null;
      if (useRealStripe) {
        const res = await subscribe({
          priceId: selected.stripePriceId,
          couponCode: couponPreview?.valid ? coupon.trim() : undefined,
        });
        if (res.status === "active") {
          router.push("/dashboard");
          return;
        }
        clientSecret = res.clientSecret;
      }

      const payErr = await payRef.current?.confirm(clientSecret);
      if (payErr) {
        setError(payErr);
        setSubmitting(false);
        return;
      }

      // 3) Enrolled — the webhook grants the level; head to the dashboard.
      router.push("/dashboard");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Something went wrong. Please try again.",
      );
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="centered-state">
        <div className="spinner" aria-label="Loading" />
      </div>
    );
  }

  if (loadError) {
    return <div className="alert alert-error">{loadError}</div>;
  }

  if (!config || !selected) {
    return (
      <div className="co-notfound">
        <h1 className="page-title">Checkout not found</h1>
        <p className="page-sub">
          We couldn’t find a plan for “{slugOrId}”. The link may be out of date.
        </p>
        <Link href="/pricing/all" className="btn btn-primary">
          View all plans
        </Link>
      </div>
    );
  }

  return (
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
        <PaymentSection ref={payRef} publishableKey={publishableKey} />

        {/* Coupon */}
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
            <span className="co-chevron" aria-hidden>
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

        <button
          type="submit"
          className="co-btn co-btn--navy co-btn--block co-submit"
          disabled={submitting}
        >
          {submitting ? "Processing…" : "Submit"}
        </button>
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
  );
}
