import { Injectable, InternalServerErrorException } from '@nestjs/common';
import Stripe from 'stripe';
import { SettingsService } from '../settings/settings.service';

// Thin wrapper around the Stripe SDK that lazily resolves the secret key from
// the (encrypted) Setting table, falling back to env. The client is rebuilt if
// the key changes so admin key rotation takes effect without a restart.
@Injectable()
export class StripeService {
  private cachedKey: string | null = null;
  private client: Stripe | null = null;

  constructor(private readonly settings: SettingsService) {}

  async getClient(): Promise<Stripe> {
    const key = await this.settings.getStripeSecretKey();
    if (!key) {
      throw new InternalServerErrorException('Stripe secret key not configured');
    }
    if (!this.client || this.cachedKey !== key) {
      this.client = new Stripe(key, { apiVersion: '2024-06-20' });
      this.cachedKey = key;
    }
    return this.client;
  }

  async getWebhookSecret(): Promise<string | null> {
    return this.settings.getStripeWebhookSecret();
  }

  // --- Product / Price provisioning for PAID levels ---

  async createProduct(name: string): Promise<Stripe.Product> {
    const stripe = await this.getClient();
    return stripe.products.create({ name });
  }

  // Keep the Stripe Product name in step with a level rename.
  async updateProduct(productId: string, name: string): Promise<Stripe.Product> {
    const stripe = await this.getClient();
    return stripe.products.update(productId, { name });
  }

  // Stripe Prices are immutable; "removing" one means archiving it (active:false)
  // so existing subscriptions keep working but it can't back a new checkout.
  async archivePrice(stripePriceId: string): Promise<Stripe.Price> {
    const stripe = await this.getClient();
    return stripe.prices.update(stripePriceId, { active: false });
  }

  async createPrice(input: {
    productId: string;
    interval: 'month' | 'year';
    amount: number; // minor units
    currency: string;
  }): Promise<Stripe.Price> {
    const stripe = await this.getClient();
    return stripe.prices.create({
      product: input.productId,
      unit_amount: input.amount,
      currency: input.currency,
      recurring: { interval: input.interval },
    });
  }

  // --- Customer / Checkout / Portal ---

  async ensureCustomer(input: {
    existingCustomerId?: string | null;
    email: string;
    userId: string;
  }): Promise<string> {
    const stripe = await this.getClient();
    if (input.existingCustomerId) return input.existingCustomerId;
    const customer = await stripe.customers.create({
      email: input.email,
      metadata: { userId: input.userId },
    });
    return customer.id;
  }

  // Keep the Stripe Customer's email in step with a local email change so
  // receipts/dunning reach the new address. Payments are keyed on the customer
  // id (not email), so this is purely about deliverability + dashboard accuracy.
  async updateCustomerEmail(customerId: string, email: string): Promise<void> {
    const stripe = await this.getClient();
    await stripe.customers.update(customerId, { email });
  }

  async createCheckoutSession(input: {
    customerId: string;
    priceId: string;
    userId: string;
    levelId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<Stripe.Checkout.Session> {
    const stripe = await this.getClient();
    return stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: input.customerId,
      line_items: [{ price: input.priceId, quantity: 1 }],
      // Stamp the user + level onto the session AND the resulting subscription
      // so events are traceable in the Stripe dashboard and reconciliation has
      // a fallback correlation key beyond the customer id.
      client_reference_id: input.userId,
      subscription_data: {
        metadata: { userId: input.userId, levelId: input.levelId },
      },
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    });
  }

  async createPortalSession(input: {
    customerId: string;
    returnUrl: string;
  }): Promise<Stripe.BillingPortal.Session> {
    const stripe = await this.getClient();
    return stripe.billingPortal.sessions.create({
      customer: input.customerId,
      return_url: input.returnUrl,
    });
  }

  // --- Embedded Elements: subscription with a client-confirmable PaymentIntent ---

  // Publishable key is public — the checkout page needs it to mount Elements.
  getPublishableKey(): Promise<string | null> {
    return this.settings.getStripePublishableKey();
  }

  // Publishable key, but only when the SECRET key is also configured — i.e. the
  // browser can actually complete a PaymentIntent. Null otherwise, so the web
  // app falls back to its mock payment path (publishable key alone is useless).
  async getElementsPublishableKey(): Promise<string | null> {
    const [pub, secret] = await Promise.all([
      this.settings.getStripePublishableKey(),
      this.settings.getStripeSecretKey(),
    ]);
    return pub && secret ? pub : null;
  }

  // Resolve an active promotion code (e.g. "SAVE20") -> its PromotionCode, which
  // carries the underlying Coupon. Returns null when unknown/inactive/expired.
  async findPromotionCode(code: string): Promise<Stripe.PromotionCode | null> {
    const stripe = await this.getClient();
    const res = await stripe.promotionCodes.list({
      code,
      active: true,
      limit: 1,
    });
    return res.data[0] ?? null;
  }

  // --- Coupons + promotion codes (admin "generate a code") ---

  // Create a Coupon (the discount). percentOff XOR amountOff(+currency).
  // duration: 'once' (first invoice) | 'repeating' (+durationInMonths) | 'forever'.
  // appliesToProducts restricts it to specific Stripe Products (per-level coupons).
  async createCoupon(input: {
    percentOff?: number;
    amountOff?: number; // minor units
    currency?: string;
    duration: 'once' | 'repeating' | 'forever';
    durationInMonths?: number;
    maxRedemptions?: number;
    redeemBy?: number; // unix seconds
    name?: string;
    appliesToProducts?: string[];
  }): Promise<Stripe.Coupon> {
    const stripe = await this.getClient();
    const params: Stripe.CouponCreateParams = { duration: input.duration };
    if (input.percentOff != null) params.percent_off = input.percentOff;
    if (input.amountOff != null) {
      params.amount_off = input.amountOff;
      params.currency = (input.currency ?? 'usd').toLowerCase();
    }
    if (input.duration === 'repeating' && input.durationInMonths != null) {
      params.duration_in_months = input.durationInMonths;
    }
    if (input.maxRedemptions != null) {
      params.max_redemptions = input.maxRedemptions;
    }
    if (input.redeemBy != null) params.redeem_by = input.redeemBy;
    if (input.name) params.name = input.name;
    if (input.appliesToProducts?.length) {
      params.applies_to = { products: input.appliesToProducts };
    }
    return stripe.coupons.create(params);
  }

  // Customer-facing promotion code mapped to a coupon. Stripe auto-generates the
  // string when `code` is omitted.
  async createPromotionCode(input: {
    couponId: string;
    code?: string;
    maxRedemptions?: number;
    expiresAt?: number; // unix seconds
    metadata?: Record<string, string>;
  }): Promise<Stripe.PromotionCode> {
    const stripe = await this.getClient();
    const params: Stripe.PromotionCodeCreateParams = { coupon: input.couponId };
    if (input.code) params.code = input.code;
    if (input.maxRedemptions != null) {
      params.max_redemptions = input.maxRedemptions;
    }
    if (input.expiresAt != null) params.expires_at = input.expiresAt;
    if (input.metadata) params.metadata = input.metadata;
    return stripe.promotionCodes.create(params);
  }

  // All promotion codes (each carries its expanded coupon, times_redeemed,
  // active, expires_at, applies_to) — powers the admin list.
  async listPromotionCodes(limit = 100): Promise<Stripe.PromotionCode[]> {
    const stripe = await this.getClient();
    const res = await stripe.promotionCodes.list({ limit });
    return res.data;
  }

  // Toggle a promotion code on/off (deactivate keeps history; reactivate if
  // it hasn't expired).
  async setPromotionCodeActive(
    id: string,
    active: boolean,
  ): Promise<Stripe.PromotionCode> {
    const stripe = await this.getClient();
    return stripe.promotionCodes.update(id, { active });
  }

  async retrievePromotionCode(id: string): Promise<Stripe.PromotionCode> {
    const stripe = await this.getClient();
    return stripe.promotionCodes.retrieve(id);
  }

  // Promotion codes can't be deleted in Stripe — update is the only mutation
  // (used to flag a soft-delete in metadata + deactivate).
  async updatePromotionCode(
    id: string,
    params: Stripe.PromotionCodeUpdateParams,
  ): Promise<Stripe.PromotionCode> {
    const stripe = await this.getClient();
    return stripe.promotionCodes.update(id, params);
  }

  // Delete a coupon — used to roll back an orphaned coupon when its promotion
  // code creation fails (e.g. duplicate code).
  async deleteCoupon(id: string): Promise<void> {
    const stripe = await this.getClient();
    await stripe.coupons.del(id);
  }

  // Create a subscription in `default_incomplete` mode so the first invoice's
  // PaymentIntent is confirmed CLIENT-SIDE via Stripe Elements. We expand the
  // PaymentIntent to return its client_secret. The existing subscription webhook
  // then reconciles the level grant once payment succeeds.
  async createSubscriptionIntent(input: {
    customerId: string;
    priceId: string;
    userId: string;
    levelId: string;
    couponId?: string;
  }): Promise<{
    subscriptionId: string;
    clientSecret: string | null;
    status: Stripe.Subscription.Status;
  }> {
    const stripe = await this.getClient();
    const sub = await stripe.subscriptions.create({
      customer: input.customerId,
      items: [{ price: input.priceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.payment_intent'],
      metadata: { userId: input.userId, levelId: input.levelId },
      ...(input.couponId ? { coupon: input.couponId } : {}),
    });
    const invoice = sub.latest_invoice;
    const pi =
      invoice && typeof invoice !== 'string' ? invoice.payment_intent : null;
    return {
      subscriptionId: sub.id,
      clientSecret: pi && typeof pi !== 'string' ? pi.client_secret : null,
      status: sub.status,
    };
  }

  // --- Subscription detail, payment history, admin actions ---

  async listSubscriptionsForCustomer(
    customerId: string,
  ): Promise<Stripe.Subscription[]> {
    const stripe = await this.getClient();
    const res = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 20,
    });
    return res.data;
  }

  async listInvoices(customerId: string, limit = 24): Promise<Stripe.Invoice[]> {
    const stripe = await this.getClient();
    const res = await stripe.invoices.list({ customer: customerId, limit });
    return res.data;
  }

  // All subscriptions across every customer (active + historical), customer
  // expanded for a name/email fallback. Auto-paginated with a hard cap so the
  // admin Subscriptions tab can't trigger an unbounded scan.
  async listAllSubscriptions(max = 1000): Promise<Stripe.Subscription[]> {
    const stripe = await this.getClient();
    return stripe.subscriptions
      .list({ status: 'all', limit: 100, expand: ['data.customer'] })
      .autoPagingToArray({ limit: max });
  }

  // All invoices across the account, for per-subscription order counts + last
  // order date. Auto-paginated with a hard cap.
  async listAllInvoices(max = 2000): Promise<Stripe.Invoice[]> {
    const stripe = await this.getClient();
    return stripe.invoices.list({ limit: 100 }).autoPagingToArray({ limit: max });
  }

  // Pause billing without canceling — access is retained (sub stays active);
  // invoices during the pause are voided. Cleared by resumeSubscription.
  async pauseSubscription(subId: string): Promise<Stripe.Subscription> {
    const stripe = await this.getClient();
    return stripe.subscriptions.update(subId, {
      pause_collection: { behavior: 'void' },
    });
  }

  // Reactivate: clear any pause AND undo a pending period-end cancellation.
  async resumeSubscription(subId: string): Promise<Stripe.Subscription> {
    const stripe = await this.getClient();
    return stripe.subscriptions.update(subId, {
      pause_collection: '',
      cancel_at_period_end: false,
    });
  }

  // Cancel at period end (reversible via resume); member keeps access until then.
  async setCancelAtPeriodEnd(
    subId: string,
    cancel: boolean,
  ): Promise<Stripe.Subscription> {
    const stripe = await this.getClient();
    return stripe.subscriptions.update(subId, { cancel_at_period_end: cancel });
  }

  async retrieveSubscription(subId: string): Promise<Stripe.Subscription> {
    const stripe = await this.getClient();
    return stripe.subscriptions.retrieve(subId);
  }

  // Cancel immediately. Used when an installment plan is paid in full: the member
  // keeps lifetime access via their UserLevel grant, so there's no reason to keep
  // the subscription around or let it bill again.
  async cancelSubscription(subId: string): Promise<Stripe.Subscription> {
    const stripe = await this.getClient();
    return stripe.subscriptions.cancel(subId);
  }

  // Invoices for a single subscription (optionally filtered by status) — used to
  // count how many installments have actually been paid.
  async listSubscriptionInvoices(
    subId: string,
    status?: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void',
  ): Promise<Stripe.Invoice[]> {
    const stripe = await this.getClient();
    const res = await stripe.invoices.list({
      subscription: subId,
      ...(status ? { status } : {}),
      limit: 100,
    });
    return res.data;
  }

  // Verify & construct a webhook event from the raw request body + signature.
  async constructEvent(
    rawBody: Buffer,
    signature: string,
    webhookSecret: string,
  ): Promise<Stripe.Event> {
    const stripe = await this.getClient();
    return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  }
}
