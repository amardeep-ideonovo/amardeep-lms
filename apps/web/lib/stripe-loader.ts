// Minimal Stripe.js loader — no npm dependency. Injects the official Stripe.js
// script from Stripe's CDN on demand and resolves the global Stripe factory.
// Used only when a publishable key is configured; otherwise the checkout uses
// its mock payment path. PCI-safe: card data is entered into Stripe-hosted
// Elements iframes, never our own inputs/DOM.

// Narrow types for just the bits of Stripe.js we use.
export interface StripeElement {
  mount(target: string | HTMLElement): void;
  unmount(): void;
}
export interface StripeElements {
  create(type: string, options?: Record<string, unknown>): StripeElement;
  getElement(type: string): StripeElement | null;
}
export interface StripeLike {
  elements(options: {
    clientSecret?: string;
    appearance?: Record<string, unknown>;
  }): StripeElements;
  confirmCardPayment(
    clientSecret: string,
    data?: { payment_method?: { card: StripeElement } },
  ): Promise<{ error?: { message?: string } }>;
}
type StripeFactory = (publishableKey: string) => StripeLike;

declare global {
  interface Window {
    Stripe?: StripeFactory;
  }
}

const SRC = "https://js.stripe.com/v3";
let pending: Promise<StripeFactory | null> | null = null;

export function loadStripeJs(): Promise<StripeFactory | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.Stripe) return Promise.resolve(window.Stripe);
  if (pending) return pending;

  pending = new Promise((resolve) => {
    const done = () => resolve(window.Stripe ?? null);
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src^="${SRC}"]`,
    );
    if (existing) {
      if (window.Stripe) return resolve(window.Stripe);
      existing.addEventListener("load", done);
      existing.addEventListener("error", () => resolve(null));
      return;
    }
    const s = document.createElement("script");
    s.src = SRC;
    s.async = true;
    s.onload = done;
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return pending;
}
