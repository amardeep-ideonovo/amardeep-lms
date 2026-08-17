// Thin service layer for the checkout page. Auth + level/billing reads are real
// API calls; the payment step is mocked by the UI when Stripe isn't configured
// (see PaymentSection). Keeping these behind one module makes the page testable
// and the data contract obvious.
import type {
  AuthUser,
  BillingConfigDTO,
  CouponPreviewDTO,
  CourseIntentResult,
  LevelDTO,
  PayPalPrepareResult,
  SignupInput,
  SubscribeInput,
  SubscribeResult,
  SubscriptionDetailDTO,
} from "@lms/types";
import { api, ApiError, clearToken, getToken, setToken } from "./api";

export { ApiError, getToken };

// Returns the signed-in member, or null when logged out / token is stale.
export async function getCurrentUser(): Promise<AuthUser | null> {
  if (!getToken()) return null;
  try {
    return await api.me();
  } catch {
    return null;
  }
}

export async function login(
  email: string,
  password: string,
): Promise<AuthUser> {
  const res = await api.login(email, password);
  setToken(res.token);
  return res.user;
}

export async function signup(input: SignupInput): Promise<AuthUser> {
  const res = await api.signup(input);
  setToken(res.token);
  return res.user;
}

export function logout(): void {
  clearToken();
}

export function getLevels(): Promise<LevelDTO[]> {
  return api.levels();
}

export function getBillingConfig(): Promise<BillingConfigDTO> {
  return api.billingConfig();
}

export function validateCoupon(
  code: string,
  priceId: string,
): Promise<CouponPreviewDTO> {
  return api.validateCoupon({ code, priceId });
}

export function subscribe(input: SubscribeInput): Promise<SubscribeResult> {
  return api.subscribe(input);
}

export function syncSubscriptions(): Promise<{ ok: true }> {
  return api.syncSubscriptions();
}

// One-off course purchase (embedded Elements, one-time PaymentIntent). Mint the
// intent (client secret) then, after Stripe.js confirms the card, grant inline;
// the payment_intent.succeeded webhook is the server-side backstop.
export function createCourseIntent(
  courseId: string,
): Promise<CourseIntentResult> {
  return api.createCourseIntent({ courseId });
}

export function confirmCourseIntent(
  paymentIntentId: string,
): Promise<{ granted: boolean }> {
  return api.confirmCourseIntent({ paymentIntentId });
}

// PayPal checkout (active provider = paypal): provision the plan, then verify
// the approved subscription server-side (which grants access inline).
export function paypalPrepare(priceId: string): Promise<PayPalPrepareResult> {
  return api.paypalPrepare({ priceId });
}

export function paypalActivate(
  subscriptionId: string,
): Promise<SubscriptionDetailDTO[]> {
  return api.paypalActivate({ subscriptionId });
}
