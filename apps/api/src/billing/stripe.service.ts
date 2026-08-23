import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import Stripe from "stripe";
import { SettingsService } from "../settings/settings.service";

// The metadata field every Stripe object we create carries while this instance
// is billing through the operator's SHARED demo account. It is what makes the
// account-wide admin reads tenant-safe — see tenantScope() below.
export const TENANT_METADATA_KEY = "lms_tenant";

// Thin wrapper around the Stripe SDK that lazily resolves the secret key from
// the (encrypted) Setting table, falling back to env. The client is rebuilt if
// the key changes so admin key rotation takes effect without a restart.
//
// SHARED-ACCOUNT MODE: an instance with no Stripe key of its own can be armed
// by the control plane with the operator's TEST-mode demo keys, so a prospect
// can run a real (fake-money) checkout during a demo. Many instances then share
// ONE Stripe account, which makes Stripe's account-wide list endpoints
// cross-tenant: every object we create is stamped with this instance's tenant
// tag, and every account-wide read is filtered back down to it. The filter is
// fail-closed — armed but untagged returns nothing rather than everything.
@Injectable()
export class StripeService {
  private cachedKey: string | null = null;
  private client: Stripe | null = null;

  constructor(private readonly settings: SettingsService) {}

  async getClient(): Promise<Stripe> {
    const keys = await this.settings.getEffectiveStripeKeys();
    if (!keys) {
      throw new InternalServerErrorException(
        "Stripe secret key not configured",
      );
    }
    if (!this.client || this.cachedKey !== keys.secretKey) {
      this.client = new Stripe(keys.secretKey, { apiVersion: "2024-06-20" });
      this.cachedKey = keys.secretKey;
    }
    return this.client;
  }

  async getWebhookSecret(): Promise<string | null> {
    return (
      (await this.settings.getEffectiveStripeKeys())?.webhookSecret ?? null
    );
  }

  /** True when a secret key is configured — the instance's own, or the
   * operator's demo test key. */
  async isConfigured(): Promise<boolean> {
    return !!(await this.settings.getEffectiveStripeKeys());
  }

  /**
   * The tenant tag to write on / filter by, or null when this instance owns its
   * Stripe account outright (nothing to filter — every object there is theirs).
   *
   * Returns "" — a tag nothing can match — when the shared account is active but
   * no tag was pushed. That is deliberate: on a shared account an unfiltered
   * read is a cross-tenant data leak, so the failure mode has to be "shows
   * nothing", never "shows everyone".
   */
  async tenantScope(): Promise<string | null> {
    const keys = await this.settings.getEffectiveStripeKeys();
    if (!keys?.demo) return null;
    return keys.tenantTag ?? "";
  }

  /**
   * A stable, non-reversible id for the Stripe account currently in use.
   *
   * Exists so caches of account-wide data can tell that the account CHANGED —
   * an instance can now switch accounts at runtime (the control plane arms or
   * revokes demo keys; the admin adds or removes their own), and a cache built
   * against one account must not keep serving after a switch. It is a hash, not
   * the key, so it can be held in memory and logged without being a credential.
   */
  async accountFingerprint(): Promise<string> {
    const keys = await this.settings.getEffectiveStripeKeys();
    if (!keys) return "none";
    return createHash("sha256")
      .update(`${keys.secretKey}|${keys.tenantTag ?? ""}`)
      .digest("hex")
      .slice(0, 16);
  }

  /** Metadata stamped onto every Stripe object created on a shared account. */
  private async tenantMeta(): Promise<Record<string, string>> {
    const tag = await this.tenantScope();
    return tag ? { [TENANT_METADATA_KEY]: tag } : {};
  }

  /** True when `meta` belongs to this tenant (always true off a shared account). */
  private ownsMeta(
    meta: Stripe.Metadata | null | undefined,
    tag: string | null,
  ): boolean {
    if (tag === null) return true; // own account — everything here is ours
    return !!tag && meta?.[TENANT_METADATA_KEY] === tag;
  }

  // --- Product / Price provisioning for PAID levels ---

  async createProduct(name: string): Promise<Stripe.Product> {
    const stripe = await this.getClient();
    return stripe.products.create({ name, metadata: await this.tenantMeta() });
  }

  // Keep the Stripe Product name in step with a level rename.
  async updateProduct(
    productId: string,
    name: string,
  ): Promise<Stripe.Product> {
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
    interval: "month" | "year";
    amount: number; // minor units
    currency: string;
  }): Promise<Stripe.Price> {
    const stripe = await this.getClient();
    return stripe.prices.create({
      product: input.productId,
      unit_amount: input.amount,
      currency: input.currency,
      recurring: { interval: input.interval },
      metadata: await this.tenantMeta(),
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
      metadata: { userId: input.userId, ...(await this.tenantMeta()) },
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
      mode: "subscription",
      customer: input.customerId,
      line_items: [{ price: input.priceId, quantity: 1 }],
      // Stamp the user + level onto the session AND the resulting subscription
      // so events are traceable in the Stripe dashboard and reconciliation has
      // a fallback correlation key beyond the customer id.
      client_reference_id: input.userId,
      subscription_data: {
        metadata: {
          userId: input.userId,
          levelId: input.levelId,
          ...(await this.tenantMeta()),
        },
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
  async getPublishableKey(): Promise<string | null> {
    return (
      (await this.settings.getEffectiveStripeKeys())?.publishableKey ?? null
    );
  }

  // Publishable key, but only when the SECRET key is also configured — i.e. the
  // browser can actually complete a PaymentIntent. Null otherwise, so the web
  // app falls back to its mock payment path (publishable key alone is useless).
  // getEffectiveStripeKeys() resolves the pair from ONE account, so this can
  // never hand the browser a key that belongs to a different account than the
  // secret key the server is charging on.
  async getElementsPublishableKey(): Promise<string | null> {
    const keys = await this.settings.getEffectiveStripeKeys();
    return keys?.publishableKey ?? null;
  }

  // Resolve an active promotion code (e.g. "SAVE20") -> its PromotionCode, which
  // carries the underlying Coupon. Returns null when unknown/inactive/expired.
  //
  // Promotion codes share ONE namespace per Stripe account, so on the shared
  // demo account a code created by one tenant would otherwise be redeemable by
  // every other. Codes that aren't ours read as unknown.
  async findPromotionCode(code: string): Promise<Stripe.PromotionCode | null> {
    const stripe = await this.getClient();
    const res = await stripe.promotionCodes.list({
      code,
      active: true,
      limit: 1,
    });
    const promo = res.data[0] ?? null;
    if (!promo) return null;
    const tag = await this.tenantScope();
    return this.ownsMeta(promo.metadata, tag) ? promo : null;
  }

  // --- Coupons + promotion codes (admin "generate a code") ---

  // Create a Coupon (the discount). percentOff XOR amountOff(+currency).
  // duration: 'once' (first invoice) | 'repeating' (+durationInMonths) | 'forever'.
  // appliesToProducts restricts it to specific Stripe Products (per-level coupons).
  async createCoupon(input: {
    percentOff?: number;
    amountOff?: number; // minor units
    currency?: string;
    duration: "once" | "repeating" | "forever";
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
      params.currency = (input.currency ?? "usd").toLowerCase();
    }
    if (input.duration === "repeating" && input.durationInMonths != null) {
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
    params.metadata = await this.tenantMeta();
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
    params.metadata = {
      ...(input.metadata ?? {}),
      ...(await this.tenantMeta()),
    };
    return stripe.promotionCodes.create(params);
  }

  // All promotion codes (each carries its expanded coupon, times_redeemed,
  // active, expires_at, applies_to) — powers the admin list. Scoped to this
  // tenant on the shared demo account (see tenantScope()); unscoped on the
  // instance's own account, where every code is already theirs.
  async listPromotionCodes(limit = 100): Promise<Stripe.PromotionCode[]> {
    const stripe = await this.getClient();
    const tag = await this.tenantScope();
    if (tag === null) {
      const res = await stripe.promotionCodes.list({ limit });
      return res.data;
    }
    // Shared account: a single page is the WHOLE account's newest codes, so an
    // academy's own coupons drop off its Coupons page as other academies create
    // theirs. Auto-page and filter, then apply the caller's limit to what is
    // actually ours.
    const all = await stripe.promotionCodes
      .list({ limit: 100 })
      .autoPagingToArray({ limit: Math.max(limit, 100) * 10 });
    return all.filter((pc) => this.ownsMeta(pc.metadata, tag)).slice(0, limit);
  }

  /**
   * Refuse to touch a promotion code belonging to another tenant on the shared
   * demo account. Without this, `setActive`/`delete` take a raw Stripe id and
   * would happily deactivate — or hard-delete the coupon behind — a code that
   * belongs to somebody else's instance.
   */
  private async assertOwnedPromotionCode(
    id: string,
  ): Promise<Stripe.PromotionCode> {
    const stripe = await this.getClient();
    const promo = await stripe.promotionCodes.retrieve(id);
    const tag = await this.tenantScope();
    if (!this.ownsMeta(promo.metadata, tag)) {
      throw new NotFoundException("Coupon not found");
    }
    return promo;
  }

  // Toggle a promotion code on/off (deactivate keeps history; reactivate if
  // it hasn't expired).
  async setPromotionCodeActive(
    id: string,
    active: boolean,
  ): Promise<Stripe.PromotionCode> {
    await this.assertOwnedPromotionCode(id);
    const stripe = await this.getClient();
    return stripe.promotionCodes.update(id, { active });
  }

  async retrievePromotionCode(id: string): Promise<Stripe.PromotionCode> {
    return this.assertOwnedPromotionCode(id);
  }

  // Promotion codes can't be deleted in Stripe — update is the only mutation
  // (used to flag a soft-delete in metadata + deactivate).
  async updatePromotionCode(
    id: string,
    params: Stripe.PromotionCodeUpdateParams,
  ): Promise<Stripe.PromotionCode> {
    await this.assertOwnedPromotionCode(id);
    const stripe = await this.getClient();
    return stripe.promotionCodes.update(id, params);
  }

  // Delete a coupon — used to roll back an orphaned coupon when its promotion
  // code creation fails (e.g. duplicate code), and to make a deleted code
  // permanently unredeemable. Ownership-checked for the same reason as the
  // promotion-code mutations above.
  async deleteCoupon(id: string): Promise<void> {
    const stripe = await this.getClient();
    const tag = await this.tenantScope();
    if (tag !== null) {
      const coupon = await stripe.coupons.retrieve(id);
      if (!this.ownsMeta(coupon.metadata, tag)) {
        throw new NotFoundException("Coupon not found");
      }
    }
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
      payment_behavior: "default_incomplete",
      payment_settings: { save_default_payment_method: "on_subscription" },
      expand: ["latest_invoice.payment_intent"],
      metadata: {
        userId: input.userId,
        levelId: input.levelId,
        ...(await this.tenantMeta()),
      },
      ...(input.couponId ? { coupon: input.couponId } : {}),
    });
    const invoice = sub.latest_invoice;
    const pi =
      invoice && typeof invoice !== "string" ? invoice.payment_intent : null;
    return {
      subscriptionId: sub.id,
      clientSecret: pi && typeof pi !== "string" ? pi.client_secret : null,
      status: sub.status,
    };
  }

  // Client secret for an EXISTING subscription's first-invoice PaymentIntent.
  // Used to reuse a not-yet-paid (incomplete) subscription instead of creating a
  // duplicate when a checkout is submitted twice.
  async getSubscriptionClientSecret(subId: string): Promise<string | null> {
    const stripe = await this.getClient();
    const sub = await stripe.subscriptions.retrieve(subId, {
      expand: ["latest_invoice.payment_intent"],
    });
    const invoice = sub.latest_invoice;
    const pi =
      invoice && typeof invoice !== "string" ? invoice.payment_intent : null;
    return pi && typeof pi !== "string" ? pi.client_secret : null;
  }

  // --- Subscription detail, payment history, admin actions ---

  async listSubscriptionsForCustomer(
    customerId: string,
  ): Promise<Stripe.Subscription[]> {
    const stripe = await this.getClient();
    // Auto-paginate: a member can accumulate many (mostly terminal) rows over
    // time, and account deletion must see EVERY live subscription — a single
    // page of 20 could push an active sub out of view and leave it billing.
    // Capped at 100 as a sane backstop against a pathological customer.
    return stripe.subscriptions
      .list({ customer: customerId, status: "all", limit: 100 })
      .autoPagingToArray({ limit: 100 });
  }

  async listInvoices(
    customerId: string,
    limit = 24,
  ): Promise<Stripe.Invoice[]> {
    const stripe = await this.getClient();
    const res = await stripe.invoices.list({ customer: customerId, limit });
    return res.data;
  }

  // All subscriptions across every customer (active + historical), customer
  // expanded for a name/email fallback. Auto-paginated with a hard cap so the
  // admin Subscriptions tab can't trigger an unbounded scan.
  //
  // On the shared demo account this list is the single largest cross-tenant
  // exposure — it carries other instances' customer emails and names straight
  // into the admin Subscriptions tab and its XLSX export — so it is filtered to
  // subscriptions this instance created.
  async listAllSubscriptions(max = 1000): Promise<Stripe.Subscription[]> {
    const stripe = await this.getClient();
    const tag = await this.tenantScope();
    // The cap bounds the ACCOUNT scan, and the tenant filter runs after it — so
    // on a shared account another academy's volume eats into the budget before
    // this one's rows are reached, and an academy could stop seeing its own
    // subscriptions. Scan deeper when sharing so the cap bounds cost rather than
    // correctness. (On an academy's own account every row is already its own,
    // and the original cap is exactly right.)
    const scan = tag === null ? max : max * 5;
    const subs = await stripe.subscriptions
      .list({ status: "all", limit: 100, expand: ["data.customer"] })
      .autoPagingToArray({ limit: scan });
    if (tag === null) return subs;
    return subs.filter((s) => this.ownsMeta(s.metadata, tag)).slice(0, max);
  }

  // All invoices across the account, for per-subscription order counts + last
  // order date. Auto-paginated with a hard cap.
  //
  // INVARIANT for shared-account safety: invoices carry no metadata of ours, so
  // this list is NOT tenant-filtered and callers must scope it themselves by
  // the ids of subscriptions that survived listAllSubscriptions() (which is
  // filtered). Re-sweeping subscriptions here to filter would double the ~10-30
  // sequential round-trips this admin tab already costs. Never surface a row
  // from this list — or any field of it — keyed by anything but one of those ids.
  async listAllInvoices(max = 2000): Promise<Stripe.Invoice[]> {
    const stripe = await this.getClient();
    // Same cap-before-filter hazard as listAllSubscriptions: the caller scopes
    // these to its own subscription ids, so on a shared account the raw budget
    // is spent partly on other academies' invoices. Scan deeper when sharing.
    const scan = (await this.tenantScope()) === null ? max : max * 5;
    return stripe.invoices
      .list({ limit: 100 })
      .autoPagingToArray({ limit: scan });
  }

  // Pause billing without canceling — access is retained (sub stays active);
  // invoices during the pause are voided. Cleared by resumeSubscription.
  async pauseSubscription(subId: string): Promise<Stripe.Subscription> {
    const stripe = await this.getClient();
    return stripe.subscriptions.update(subId, {
      pause_collection: { behavior: "void" },
    });
  }

  // Resume a PAUSED subscription: clear the pause only. We deliberately do NOT
  // clear cancel_at_period_end — cancellation is final, so Resume must never
  // revive a cancelled subscription.
  async resumeSubscription(subId: string): Promise<Stripe.Subscription> {
    const stripe = await this.getClient();
    return stripe.subscriptions.update(subId, {
      pause_collection: "",
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

  async retrieveCharge(chargeId: string): Promise<Stripe.Charge> {
    const stripe = await this.getClient();
    return stripe.charges.retrieve(chargeId);
  }

  async retrieveInvoice(invoiceId: string): Promise<Stripe.Invoice> {
    const stripe = await this.getClient();
    return stripe.invoices.retrieve(invoiceId);
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
    status?: "draft" | "open" | "paid" | "uncollectible" | "void",
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
