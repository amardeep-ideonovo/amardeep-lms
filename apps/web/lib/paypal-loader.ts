// Minimal PayPal JS SDK loader — no npm dependency, mirroring stripe-loader.
// Injects the official SDK from PayPal's CDN with the merchant's client id and
// `intent=subscription` (vaulted), then resolves the global `paypal.Buttons`
// factory. Sandbox vs live is determined by the client id itself. Used only
// when the admin has made PayPal the active provider AND configured a client
// id; otherwise the checkout shows its mock PayPal path.

// Narrow types for just the Buttons surface we use.
export interface PayPalButtonsActions {
  subscription: {
    create(input: { plan_id: string; custom_id?: string }): Promise<string>;
  };
}
export interface PayPalOnClickActions {
  resolve(): void;
  reject(): void;
}
export interface PayPalButtonsConfig {
  style?: Record<string, unknown>;
  onClick?(
    data: Record<string, unknown>,
    actions: PayPalOnClickActions,
  ): void | Promise<void>;
  createSubscription(
    data: Record<string, unknown>,
    actions: PayPalButtonsActions,
  ): Promise<string>;
  onApprove(data: { subscriptionID?: string | null }): void | Promise<void>;
  onError?(err: unknown): void;
  onCancel?(): void;
}
export interface PayPalButtons {
  render(target: string | HTMLElement): Promise<void>;
  close?(): Promise<void>;
}
export interface PayPalNamespace {
  Buttons(config: PayPalButtonsConfig): PayPalButtons;
}

declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}

let pending: Promise<PayPalNamespace | null> | null = null;
let loadedClientId: string | null = null;

export function loadPayPalJs(
  clientId: string,
): Promise<PayPalNamespace | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.paypal && loadedClientId === clientId) {
    return Promise.resolve(window.paypal);
  }
  if (pending && loadedClientId === clientId) return pending;

  loadedClientId = clientId;
  const src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(
    clientId,
  )}&vault=true&intent=subscription`;
  pending = new Promise((resolve) => {
    const done = () => resolve(window.paypal ?? null);
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-paypal-sdk="1"]',
    );
    if (existing) {
      if (existing.src === src && window.paypal) return resolve(window.paypal);
      // A different client id was loaded before — replace the script (the SDK
      // namespace is rebuilt on load).
      existing.remove();
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.dataset.paypalSdk = "1";
    s.onload = done;
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return pending;
}
