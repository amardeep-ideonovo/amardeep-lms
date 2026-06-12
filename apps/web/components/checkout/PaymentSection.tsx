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
import { loadPayPalJs, type PayPalButtons } from "@/lib/paypal-loader";

export type PaymentHandle = {
  // Confirm the payment. `clientSecret` comes from POST /billing/subscribe and is
  // ignored in mock mode. Resolves an error message on failure, or null on success.
  // PayPal checkouts never call this — the PayPal Buttons drive their own flow.
  confirm: (clientSecret: string | null) => Promise<string | null>;
};

// The page owns the PayPal flow; the section just wires the Buttons to it.
// Handlers are read through a ref at call time, so they always see fresh state
// even though the Buttons render once.
export type PayPalDriver = {
  validate: () => string | null; // form check before the PayPal popup opens
  createSubscription: () => Promise<{ planId: string; customId: string }>;
  onApproved: (subscriptionId: string) => void;
  onError: (message: string) => void;
  onMockPay: () => void; // mock-mode "Pay with PayPal" click
};

type Props = {
  provider: "stripe" | "paypal";
  publishableKey: string | null;
  paypalClientId: string | null;
  paypal?: PayPalDriver;
};

// Simple text badges for the mock card row (the real Card Element draws its own).
const CARD_BRANDS = ["VISA", "MC", "AMEX", "JCB"];

// Renders the active provider's payment UI:
//  - stripe + publishableKey  → real Stripe Card Element (Stripe-hosted iframe)
//  - stripe + null key        → mock card form (fully testable UI)
//  - paypal + clientId        → real PayPal Buttons (subscription intent)
//  - paypal + null clientId   → mock PayPal button
const PaymentSection = forwardRef<PaymentHandle, Props>(
  function PaymentSection({ provider, publishableKey, paypalClientId, paypal }, ref) {
    const mock = !publishableKey;
    const stripeRef = useRef<StripeLike | null>(null);
    const elementsRef = useRef<StripeElements | null>(null);
    const mountRef = useRef<HTMLDivElement | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);

    // Mock fields — controlled for visual parity + light validation.
    const [card, setCard] = useState("");
    const [exp, setExp] = useState("");
    const [cvc, setCvc] = useState("");

    // PayPal wiring. The driver lives in a ref so the once-rendered Buttons
    // callbacks never capture stale page state.
    const paypalContainerRef = useRef<HTMLDivElement | null>(null);
    const paypalButtonsRef = useRef<PayPalButtons | null>(null);
    const driverRef = useRef<PayPalDriver | undefined>(paypal);
    driverRef.current = paypal;

    useEffect(() => {
      if (provider !== "stripe" || mock || !publishableKey) return;
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
    }, [provider, mock, publishableKey]);

    // Mount the PayPal Buttons once per client id.
    useEffect(() => {
      if (provider !== "paypal" || !paypalClientId) return;
      let cancelled = false;
      void (async () => {
        const ns = await loadPayPalJs(paypalClientId);
        if (cancelled) return;
        if (!ns) {
          setLoadError("Could not load PayPal. Please refresh and try again.");
          return;
        }
        if (!paypalContainerRef.current) return;
        paypalContainerRef.current.innerHTML = "";
        const buttons = ns.Buttons({
          style: { layout: "vertical", label: "subscribe", height: 48 },
          onClick: (_data, actions) => {
            const err = driverRef.current?.validate() ?? null;
            if (err) {
              driverRef.current?.onError(err);
              actions.reject();
              return;
            }
            actions.resolve();
          },
          createSubscription: async (_data, actions) => {
            if (!driverRef.current) throw new Error("Checkout not ready");
            const { planId, customId } =
              await driverRef.current.createSubscription();
            return actions.subscription.create({
              plan_id: planId,
              custom_id: customId,
            });
          },
          onApprove: (data) => {
            if (data.subscriptionID) {
              driverRef.current?.onApproved(data.subscriptionID);
            } else {
              driverRef.current?.onError(
                "PayPal didn't return a subscription. Please try again.",
              );
            }
          },
          onError: (err) => {
            const msg =
              err instanceof Error && err.message
                ? err.message
                : "PayPal couldn't complete the payment. Please try again.";
            driverRef.current?.onError(msg);
          },
        });
        paypalButtonsRef.current = buttons;
        void buttons.render(paypalContainerRef.current).catch(() => {
          if (!cancelled)
            setLoadError("Could not display the PayPal button. Please refresh.");
        });
      })();
      return () => {
        cancelled = true;
        void paypalButtonsRef.current?.close?.();
        paypalButtonsRef.current = null;
      };
    }, [provider, paypalClientId]);

    useImperativeHandle(
      ref,
      () => ({
        async confirm(clientSecret) {
          if (provider === "paypal") {
            // Defensive: the page hides the Submit button under PayPal.
            return "Use the PayPal button to complete your purchase.";
          }
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
      [provider, mock, card, exp, cvc],
    );

    if (provider === "paypal") {
      if (!paypalClientId) {
        return (
          <div className="co-pay-mock">
            <button
              type="button"
              className="co-btn co-btn--navy co-btn--block"
              onClick={() => paypal?.onMockPay()}
            >
              Pay with PayPal
            </button>
            <p className="co-mock-note">
              PayPal isn’t configured here — using a mock payment flow. The real
              PayPal button appears once credentials are set.
            </p>
          </div>
        );
      }
      return (
        <div>
          <div ref={paypalContainerRef} />
          <p className="co-mock-note">
            You’ll approve the subscription in PayPal — no card details are
            entered on this page.
          </p>
          {loadError && (
            <div className="co-alert co-alert-error" style={{ marginTop: 8 }}>
              {loadError}
            </div>
          )}
        </div>
      );
    }

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
