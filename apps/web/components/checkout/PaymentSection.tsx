"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  loadStripeJs,
  type StripeElements,
  type StripeLike,
} from "@/lib/stripe-loader";

export type PaymentHandle = {
  // Confirm the payment. `clientSecret` comes from POST /billing/subscribe and is
  // ignored in mock mode. Resolves an error message on failure, or null on success.
  confirm: (clientSecret: string | null) => Promise<string | null>;
};

// Simple text badges for the mock card row (the real Card Element draws its own).
const CARD_BRANDS = ["VISA", "MC", "AMEX", "JCB"];

// publishableKey null → Stripe not configured → mock card form (fully testable
// UI; never sends card data anywhere). Otherwise mounts a real Stripe Card
// Element (Stripe-hosted iframe) loaded from the CDN.
const PaymentSection = forwardRef<PaymentHandle, { publishableKey: string | null }>(
  function PaymentSection({ publishableKey }, ref) {
    const mock = !publishableKey;
    const stripeRef = useRef<StripeLike | null>(null);
    const elementsRef = useRef<StripeElements | null>(null);
    const mountRef = useRef<HTMLDivElement | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);

    // Mock fields — controlled for visual parity + light validation.
    const [card, setCard] = useState("");
    const [exp, setExp] = useState("");
    const [cvc, setCvc] = useState("");

    useEffect(() => {
      if (mock || !publishableKey) return;
      let cancelled = false;
      void (async () => {
        const factory = await loadStripeJs();
        if (cancelled) return;
        if (!factory) {
          setLoadError("Could not load the secure payment form.");
          return;
        }
        const stripe = factory(publishableKey);
        stripeRef.current = stripe;
        const elements = stripe.elements({});
        const cardEl = elements.create("card", {
          // Dark checkout: light text + placeholder so the Stripe-hosted card
          // iframe stays legible (CSS can't reach inside that iframe).
          style: {
            base: {
              fontSize: "16px",
              color: "#f4f4f6",
              "::placeholder": { color: "#8a8a95" },
            },
          },
        });
        if (mountRef.current) cardEl.mount(mountRef.current);
        elementsRef.current = elements;
      })();
      return () => {
        cancelled = true;
      };
    }, [mock, publishableKey]);

    useImperativeHandle(
      ref,
      () => ({
        async confirm(clientSecret) {
          if (mock) {
            if (card.replace(/\s/g, "").length < 12)
              return "Enter a valid card number.";
            if (!/^\d{2}\s*\/\s*\d{2,4}$/.test(exp.trim()))
              return "Enter a valid expiry date (MM/YY).";
            if (cvc.trim().length < 3) return "Enter a valid security code.";
            await new Promise((r) => setTimeout(r, 600)); // simulate network
            return null; // success
          }
          const stripe = stripeRef.current;
          const elements = elementsRef.current;
          const cardEl = elements?.getElement("card");
          if (!stripe || !cardEl) return "Payment form isn’t ready yet.";
          if (!clientSecret) return "Missing payment session. Please retry.";
          const res = await stripe.confirmCardPayment(clientSecret, {
            payment_method: { card: cardEl },
          });
          return res.error?.message ?? null;
        },
      }),
      [mock, card, exp, cvc],
    );

    if (!mock) {
      return (
        <div>
          <div ref={mountRef} className="co-input co-card-element" />
          {loadError && (
            <div className="co-alert co-alert-error" style={{ marginTop: 8 }}>
              {loadError}
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="co-pay-mock">
        <div className="co-input co-card-row">
          <input
            className="co-bare"
            inputMode="numeric"
            placeholder="Card number"
            value={card}
            onChange={(e) => setCard(e.target.value)}
            aria-label="Card number"
          />
          <div className="co-brands" aria-hidden>
            {CARD_BRANDS.map((b) => (
              <span key={b} className="co-brand">
                {b}
              </span>
            ))}
          </div>
        </div>
        <div className="co-grid2">
          <input
            className="co-input"
            placeholder="Expiration date"
            value={exp}
            onChange={(e) => setExp(e.target.value)}
            aria-label="Expiration date"
          />
          <input
            className="co-input"
            placeholder="Security code"
            value={cvc}
            onChange={(e) => setCvc(e.target.value)}
            aria-label="Security code"
          />
        </div>
        <p className="co-mock-note">
          Stripe isn’t configured here — using a mock payment form. Card entry
          switches to secure Stripe Elements once keys are set.
        </p>
      </div>
    );
  },
);

export default PaymentSection;
