import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import type Stripe from 'stripe';
import type {
  BillingConfigDTO,
  CouponPreviewDTO,
  CouponValidateInput,
  InvoiceDTO,
  MemberBillingDTO,
  MySubscriptionDTO,
  SubscribeInput,
  SubscribeResult,
  SubscriptionDetailDTO,
} from '@lms/types';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from './stripe.service';
import { PayPalService, type PayPalSubscription } from './paypal.service';
import { SettingsService } from '../settings/settings.service';
import { MailchimpProducer } from '../mailchimp/mailchimp.producer';
import { ContactsService } from '../contacts/contacts.service';
import {
  NotificationsService,
  type RecordNotificationInput,
} from '../notifications/notifications.service';
import { AutomationService } from '../email/automation.service';

// Maps Stripe subscription.status -> our SubStatus / UserLevelStatus.
function mapSubStatus(status: Stripe.Subscription.Status): {
  sub: 'ACTIVE' | 'TRIALING' | 'PAST_DUE' | 'CANCELED' | 'UNPAID' | 'INCOMPLETE';
  userLevel: 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED';
} {
  switch (status) {
    case 'active':
      return { sub: 'ACTIVE', userLevel: 'ACTIVE' };
    case 'trialing':
      return { sub: 'TRIALING', userLevel: 'ACTIVE' };
    case 'past_due':
      return { sub: 'PAST_DUE', userLevel: 'PAST_DUE' };
    case 'unpaid':
      return { sub: 'UNPAID', userLevel: 'PAST_DUE' };
    case 'canceled':
      return { sub: 'CANCELED', userLevel: 'CANCELED' };
    case 'incomplete':
    case 'incomplete_expired':
    case 'paused':
    default:
      return { sub: 'INCOMPLETE', userLevel: 'EXPIRED' };
  }
}


// A Price row with its Level — the shape every checkout path resolves.
type PriceWithLevel = Prisma.PriceGetPayload<{ include: { level: true } }>;

// ---------- Provider-neutral reconcile contracts ----------
// One subscription item normalized to our domain: the level it grants plus the
// Mailchimp wiring needed on status transitions.
interface NormalizedSubItem {
  levelId: string;
  levelName: string;
  subItemId: string; // si_… (Stripe item) | I-… (PayPal sub id doubles as item)
  audienceTags: string[];
  audienceId: string | null; // INTERNAL Audience id (null = default "Members")
}

// A provider subscription reduced to exactly what reconciliation needs. Built
// by a per-provider mapper (Stripe / PayPal); applied by applySubscriptionState.
interface NormalizedSubState {
  provider: 'STRIPE' | 'PAYPAL'; // also the UserLevel source for grants
  externalSubId: string; // sub_… | I-…
  externalCustomerId: string; // cus_… | PayPal payer id (mirror display only)
  user: { id: string; email: string };
  subStatus:
    | 'ACTIVE'
    | 'TRIALING'
    | 'PAST_DUE'
    | 'CANCELED'
    | 'UNPAID'
    | 'INCOMPLETE'
    | 'PAUSED';
  userLevelStatus: 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED' | 'PAUSED';
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  items: NormalizedSubItem[];
  // PayPal period-end cancel: PayPal cancels immediately, so access is OUR
  // grace — keep the grant ACTIVE with expiresAt=graceExpiresAt and let the
  // expiry sweep flip it once the paid period runs out. Null for Stripe.
  graceExpiresAt: Date | null;
  // Local Price.id recorded on PAYPAL mirror rows (the mirror is the index —
  // PayPal has no list API). Null for Stripe (multi-item subs are ambiguous).
  mirrorPriceId: string | null;
  // Legacy dedupe-key fragment (Stripe: current_period_end unix seconds).
  periodKey: string | number;
}

@Injectable()
export class BillingService implements OnModuleInit {
  private readonly logger = new Logger(BillingService.name);
  // Installments→lifetime conversion + global pause=no-access live in the
  // webhook reconcile + fulfillInstallmentsIfComplete below.

  // PayPal grace-expiry sweep state (see sweepExpiredPayPalGrants).
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly paypal: PayPalService,
    private readonly settings: SettingsService,
    private readonly mailchimp: MailchimpProducer,
    private readonly contacts: ContactsService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly automations: AutomationService,
  ) {}

  // PayPal "cancel at period end" keeps the grant ACTIVE with an expiresAt
  // (PayPal itself cancels immediately) — something must flip the grant once
  // the paid period runs out. Webhooks can't (the sub is already CANCELLED),
  // so an hourly sweep + a lazy per-user check on the account reads do it.
  onModuleInit(): void {
    this.sweepTimer = setInterval(
      () => void this.sweepExpiredPayPalGrants(),
      60 * 60 * 1000,
    );
    // Never hold the process open (tests, one-off scripts).
    this.sweepTimer.unref?.();
    void this.sweepExpiredPayPalGrants();
  }

  // Where Stripe redirects users back to (the MEMBER WEB app, not the API).
  private appUrl(): string {
    return this.config.get<string>('WEB_APP_URL') || 'http://localhost:3002';
  }

  // Brand title for member-facing automation emails. Read straight from the
  // AppConfig singleton (we don't inject AppConfigService — billing isn't in its
  // module) and fall back to the default if the row is missing/blank.
  private async brandTitle(): Promise<string> {
    try {
      const row = await this.prisma.appConfig.findUnique({
        where: { id: 'singleton' },
      });
      const title = (row?.config as { title?: unknown } | null)?.title;
      return typeof title === 'string' && title.trim() ? title : 'LMS';
    } catch {
      return 'LMS';
    }
  }

  // Fire a member-facing automation for a subscription lifecycle event, off the
  // hot path: resolves the member's firstName (s.user only carries id+email) and
  // the brand, then hands off to AutomationService.fire (best-effort, never
  // throws — but we still guard so reconcile can't break here). Mirrors the
  // SIGNUP/CERTIFICATE_ISSUED wiring in auth/certificates services.
  private async fireSubscriptionAutomation(
    trigger: 'SUBSCRIPTION_ACTIVE' | 'SUBSCRIPTION_CANCELED',
    user: { id: string; email: string },
    planLabel: string,
  ): Promise<void> {
    try {
      const [member, brand] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: user.id },
          select: { firstName: true },
        }),
        this.brandTitle(),
      ]);
      const firstName = member?.firstName?.trim() || 'there';
      await this.automations.fire(trigger, {
        email: user.email,
        vars: { firstName, brand, plan: planLabel },
      });
    } catch (err) {
      this.logger.warn(
        `[billing] ${trigger} automation failed for ${user.email}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  // ---------- Admin notifications (emit helpers) ----------

  // Emit an admin notification WITHOUT ever throwing into the caller. The Stripe
  // webhook path rethrows on error to trigger Stripe retries, so a notification
  // insert must never be the reason reconciliation fails.
  private async notify(input: RecordNotificationInput): Promise<void> {
    try {
      await this.notifications.record(input);
    } catch (err) {
      this.logger.warn(
        `[notify] failed type=${input.type} key=${input.dedupeKey}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // Minor units -> display string, e.g. (12000, "usd") => "$120.00".
  private formatMoney(
    amountMinor: number | null | undefined,
    currency: string | null | undefined,
  ): string {
    const amt = (amountMinor ?? 0) / 100;
    const cur = (currency || 'usd').toUpperCase();
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: cur,
      }).format(amt);
    } catch {
      return `${amt.toFixed(2)} ${cur}`;
    }
  }

  // Emit a PAYMENT_SUCCEEDED / PAYMENT_FAILED notification for one invoice.
  // Keyed by invoice id => exactly one per invoice (Stripe resends are no-ops).
  // The first invoice of a new subscription is suppressed in favor of the
  // SUBSCRIPTION_CREATED notification.
  private async notifyInvoiceEvent(
    eventType: 'invoice.paid' | 'invoice.payment_failed',
    invoice: Stripe.Invoice,
    sub: Stripe.Subscription,
  ): Promise<void> {
    const customerId =
      typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
    const user = await this.prisma.user.findUnique({
      where: { stripeCustomerId: customerId },
      select: { id: true, email: true },
    });
    // Not a local member (a Stripe-side-only customer, or a test event) — there's
    // nothing actionable to surface to admins, so don't create a notification.
    if (!user) return;
    if (eventType === 'invoice.payment_failed') {
      const amount = this.formatMoney(invoice.amount_due, invoice.currency);
      await this.notify({
        type: 'PAYMENT_FAILED',
        severity: 'CRITICAL',
        title: 'Payment failed',
        body: `${user.email} — payment of ${amount} failed`,
        userId: user.id,
        dedupeKey: `inv:failed:${invoice.id}`,
      });
      return;
    }
    // invoice.paid — skip the signup invoice (covered by SUBSCRIPTION_CREATED).
    if (invoice.billing_reason === 'subscription_create') return;
    const amount = this.formatMoney(invoice.amount_paid, invoice.currency);
    await this.notify({
      type: 'PAYMENT_SUCCEEDED',
      severity: 'INFO',
      title: 'Payment received',
      body: `${user.email} — paid ${amount}`,
      userId: user.id,
      dedupeKey: `inv:paid:${invoice.id}`,
    });
  }

  // ---------- Checkout ----------

  async createCheckout(userId: string, priceId: string): Promise<{ url: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // Only ever start checkout for a price WE provisioned. This rejects stale,
    // unknown, or foreign price ids with a clean 404 (instead of forwarding
    // them to Stripe and surfacing a raw "No such price" failure), and gives
    // us the target Level for the duplicate-subscription guard below.
    const price = await this.findPriceByWireId(priceId);
    if (!price || !price.active) {
      throw new NotFoundException('This plan is not available');
    }

    // Prevent a second concurrent subscription to a level the member already
    // pays for — on EITHER provider — double-charging them. To change or
    // cancel an existing paid plan they use their account page.
    const existingPaid = await this.prisma.userLevel.findFirst({
      where: {
        userId: user.id,
        levelId: price.levelId,
        source: { in: ['STRIPE', 'PAYPAL'] },
        status: { in: ['ACTIVE', 'PAST_DUE'] },
      },
    });
    if (existingPaid) {
      throw new BadRequestException(
        'You already have an active subscription to this class. Manage it from your account.',
      );
    }

    const customerId = await this.stripe.ensureCustomer({
      existingCustomerId: user.stripeCustomerId,
      email: user.email,
      userId: user.id,
    });
    if (customerId !== user.stripeCustomerId) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: customerId },
      });
    }

    const session = await this.stripe.createCheckoutSession({
      customerId,
      priceId: await this.ensureStripePrice(price),
      userId: user.id,
      levelId: price.levelId,
      successUrl: `${this.appUrl()}/account?checkout=success`,
      cancelUrl: `${this.appUrl()}/account?checkout=cancel`,
    });
    if (!session.url) {
      throw new BadRequestException('Stripe did not return a checkout URL');
    }
    return { url: session.url };
  }

  // ---------- Member's own subscriptions ----------

  // The levels this member currently pays for (STRIPE-sourced, live status).
  // Lets the web pricing/checkout UI flag a plan they already hold instead of
  // offering a duplicate checkout (which the createCheckout guard also blocks).
  async mySubscriptions(userId: string): Promise<MySubscriptionDTO[]> {
    const rows = await this.prisma.userLevel.findMany({
      where: {
        userId,
        source: { in: ['STRIPE', 'PAYPAL'] },
        status: { in: ['ACTIVE', 'PAST_DUE'] },
      },
      select: { levelId: true, status: true },
    });
    return rows.map((r) => ({
      levelId: r.levelId,
      status: r.status as MySubscriptionDTO['status'],
    }));
  }

  // ---------- Customer Portal ----------

  async createPortal(userId: string): Promise<{ url: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (!user.stripeCustomerId) {
      throw new BadRequestException('No Stripe customer for this user');
    }
    const session = await this.stripe.createPortalSession({
      customerId: user.stripeCustomerId,
      returnUrl: `${this.appUrl()}/account`,
    });
    return { url: session.url };
  }

  // ---------- Embedded checkout (Stripe Elements) ----------

  // Public config for the checkout page. `provider` is the admin-selected
  // processor for NEW checkouts; each provider's key is null when it isn't
  // fully configured — the web app then runs its mock payment path.
  async getConfig(): Promise<BillingConfigDTO> {
    const [provider, publishableKey, paypalCfg] = await Promise.all([
      this.settings.getPaymentProvider(),
      this.stripe.getElementsPublishableKey(),
      this.paypal.getClientConfig(),
    ]);
    return {
      provider,
      publishableKey,
      paypalClientId: paypalCfg?.clientId ?? null,
      paypalMode: paypalCfg?.mode ?? null,
    };
  }

  // Start an embedded subscription: same price + duplicate guard as hosted
  // checkout, resolve an optional promo code, then create a default_incomplete
  // subscription and return the PaymentIntent client secret for the browser to
  // confirm via Stripe Elements. The webhook reconciles the grant on success.
  async subscribe(
    userId: string,
    input: SubscribeInput,
  ): Promise<SubscribeResult> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const price = await this.findPriceByWireId(input.priceId);
    if (!price || !price.active) {
      throw new NotFoundException('This plan is not available');
    }

    const existingPaid = await this.prisma.userLevel.findFirst({
      where: {
        userId: user.id,
        levelId: price.levelId,
        source: { in: ['STRIPE', 'PAYPAL'] },
        status: { in: ['ACTIVE', 'PAST_DUE'] },
      },
    });
    if (existingPaid) {
      throw new BadRequestException(
        'You already have an active subscription to this class. Manage it from your account.',
      );
    }

    const customerId = await this.stripe.ensureCustomer({
      existingCustomerId: user.stripeCustomerId,
      email: user.email,
      userId: user.id,
    });
    if (customerId !== user.stripeCustomerId) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: customerId },
      });
    }

    // The Stripe side of this checkout needs a provisioned Stripe price (a row
    // born under a PayPal-only configuration lazily backfills here).
    const stripePriceId = await this.ensureStripePrice(price);

    // Authoritative duplicate guard: a member must never hold two live
    // subscriptions to the SAME CLASS — even via different prices (a class can
    // have a monthly AND a yearly price). So match the customer's real Stripe
    // subscriptions against ALL of this class's prices, not just the one being
    // bought. The local UserLevel check above is also per-class but only sees
    // already-reconciled grants; checking Stripe catches the not-yet-reconciled
    // case (a fast double-submit, or dev with no webhook).
    const classPriceIds = new Set(
      (
        await this.prisma.price.findMany({
          where: { levelId: price.levelId },
          select: { stripePriceId: true },
        })
      )
        .map((p) => p.stripePriceId)
        .filter((v): v is string => !!v),
    );
    const priceOf = (it: Stripe.SubscriptionItem): string | undefined =>
      typeof it.price === 'string' ? it.price : it.price?.id;
    const customerSubs =
      await this.stripe.listSubscriptionsForCustomer(customerId);
    const subsForClass = customerSubs.filter((s) =>
      s.items.data.some((it) => {
        const id = priceOf(it);
        return id != null && classPriceIds.has(id);
      }),
    );
    const liveStatuses = ['active', 'trialing', 'past_due', 'unpaid'];
    if (subsForClass.some((s) => liveStatuses.includes(s.status))) {
      throw new BadRequestException(
        'You already have an active subscription to this class. Manage it from your account.',
      );
    }
    // A not-yet-paid subscription from a moments-ago submit (same price): reuse
    // its payment intent instead of creating a second one, so the member only
    // ever pays once.
    const pending = subsForClass.find(
      (s) =>
        s.status === 'incomplete' &&
        s.items.data.some((it) => priceOf(it) === stripePriceId),
    );
    if (pending) {
      const clientSecret = await this.stripe.getSubscriptionClientSecret(
        pending.id,
      );
      if (clientSecret) {
        return {
          status: 'requires_payment',
          clientSecret,
          subscriptionId: pending.id,
        };
      }
    }

    let couponId: string | undefined;
    if (input.couponCode?.trim()) {
      const promo = await this.stripe.findPromotionCode(input.couponCode.trim());
      if (!promo) {
        throw new BadRequestException('Invalid or expired coupon code');
      }
      const restrictedProduct = promo.metadata?.levelProductId;
      if (
        restrictedProduct &&
        restrictedProduct !== price.level.stripeProductId
      ) {
        throw new BadRequestException(
          'This coupon is not valid for the selected plan',
        );
      }
      couponId =
        typeof promo.coupon === 'string' ? promo.coupon : promo.coupon.id;
    }

    const result = await this.stripe.createSubscriptionIntent({
      customerId,
      priceId: stripePriceId,
      userId: user.id,
      levelId: price.levelId,
      couponId,
    });
    return {
      status: result.status === 'active' ? 'active' : 'requires_payment',
      clientSecret: result.clientSecret,
      subscriptionId: result.subscriptionId,
    };
  }

  // Reconcile the member's Stripe subscriptions into local grants + mirror +
  // notifications INLINE. The web checkout calls this right after a successful
  // payment so a purchase reflects immediately without waiting on a Stripe
  // webhook (dev needs no `stripe listen`). Idempotent + dedupe-safe — mirrors
  // how the admin pause/resume/cancel actions already reconcile inline.
  // Reconcile ALL of a Stripe customer's subscriptions into local grants +
  // mirror + notifications. Terminal subs first, live subs LAST so a level held
  // by more than one subscription ends with the live status winning.
  private async reconcileCustomer(
    customerId: string,
    tag: string,
  ): Promise<void> {
    const subs = await this.stripe.listSubscriptionsForCustomer(customerId);
    const isLive = (s: Stripe.Subscription) =>
      ['active', 'trialing', 'past_due', 'unpaid'].includes(s.status);
    subs.sort((a, b) => Number(isLive(a)) - Number(isLive(b)));
    for (const sub of subs) {
      await this.reconcileSubscription(sub, `${tag}:${sub.id}`);
    }
  }

  async syncMySubscriptions(userId: string): Promise<{ ok: true }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user?.stripeCustomerId) {
      await this.reconcileCustomer(user.stripeCustomerId, 'sync');
    }
    return { ok: true };
  }

  // Validate a promo code against a price and return a discount preview.
  async validateCoupon(input: CouponValidateInput): Promise<CouponPreviewDTO> {
    const code = input.code.trim();
    const base: CouponPreviewDTO = {
      valid: false,
      code,
      label: null,
      amountOff: null,
      percentOff: null,
      message: null,
    };
    if (!code) return { ...base, message: 'Enter a code' };

    const price = await this.findPriceByWireId(input.priceId);
    if (!price) return { ...base, message: 'Plan not found' };

    const promo = await this.stripe.findPromotionCode(code);
    if (!promo) return { ...base, message: 'Invalid or expired code' };

    // Per-level coupons carry the target product in metadata (set by the admin
    // Coupons feature). Reject the preview when it doesn't match this plan.
    const restrictedProduct = promo.metadata?.levelProductId;
    if (restrictedProduct && restrictedProduct !== price.level.stripeProductId) {
      return { ...base, message: 'Not valid for this plan' };
    }

    const coupon = promo.coupon;
    const percentOff = coupon.percent_off ?? null;
    const amountOff = coupon.amount_off ?? null;
    const computed =
      amountOff ??
      (percentOff != null
        ? Math.round((price.amount * percentOff) / 100)
        : null);
    const label =
      percentOff != null
        ? `${percentOff}% off`
        : amountOff != null
          ? `${(amountOff / 100).toFixed(2)} ${(
              coupon.currency ?? price.currency
            ).toUpperCase()} off`
          : 'Discount applied';
    return { valid: true, code, label, amountOff: computed, percentOff, message: null };
  }

  // ---------- Subscription detail + payment history ----------

  // Map a customer's live subscriptions to enriched detail DTOs. Interval/amount
  // come from our local Price row (the ACTUAL subscribed price) — this is what
  // fixes the "shows /month when they bought /year" display bug.
  private async detailsForCustomer(
    customerId: string | null,
  ): Promise<SubscriptionDetailDTO[]> {
    if (!customerId) return [];
    const subs = await this.stripe.listSubscriptionsForCustomer(customerId);
    const out: SubscriptionDetailDTO[] = [];
    for (const sub of subs) {
      if (sub.status === 'canceled' || sub.status === 'incomplete_expired') {
        continue;
      }
      for (const item of sub.items.data) {
        const stripePriceId =
          typeof item.price === 'string' ? item.price : item.price?.id;
        if (!stripePriceId) continue;
        const price = await this.prisma.price.findUnique({
          where: { stripePriceId },
          include: { level: true },
        });
        if (!price) continue;
        // For installment plans, surface how many of the N payments are done.
        let installmentsPaid: number | null = null;
        if (price.installments != null) {
          const paidInvoices = await this.stripe.listSubscriptionInvoices(
            sub.id,
            'paid',
          );
          installmentsPaid = paidInvoices.length;
        }
        out.push({
          stripeSubId: sub.id,
          provider: 'stripe',
          levelId: price.levelId,
          levelName: price.level.name,
          status: sub.status,
          interval: price.interval,
          amount: price.amount,
          currency: price.currency,
          currentPeriodEnd: sub.current_period_end
            ? new Date(sub.current_period_end * 1000).toISOString()
            : null,
          cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
          paused: sub.pause_collection != null,
          installmentsTotal: price.installments ?? null,
          installmentsPaid,
        });
      }
    }
    return out;
  }

  private async invoicesForCustomer(
    customerId: string | null,
  ): Promise<InvoiceDTO[]> {
    if (!customerId) return [];
    const invoices = await this.stripe.listInvoices(customerId);
    return invoices.map((inv) => ({
      id: inv.id,
      number: inv.number ?? null,
      created: new Date(inv.created * 1000).toISOString(),
      amountPaid: inv.amount_paid,
      amountDue: inv.amount_due,
      currency: inv.currency,
      status: inv.status ?? 'unknown',
      description: inv.lines?.data?.[0]?.description ?? null,
      hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
      invoicePdf: inv.invoice_pdf ?? null,
    }));
  }

  async getMySubscriptionDetails(
    userId: string,
  ): Promise<SubscriptionDetailDTO[]> {
    // Lazy grace check: an expired PayPal period-end cancel flips here even if
    // the hourly sweep hasn't run yet.
    await this.sweepExpiredPayPalGrants(userId);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const [stripeSubs, paypalSubs] = await Promise.all([
      this.detailsForCustomer(user?.stripeCustomerId ?? null),
      this.paypalDetailsForUser(userId),
    ]);
    return [...stripeSubs, ...paypalSubs];
  }

  async getMyInvoices(userId: string): Promise<InvoiceDTO[]> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const [stripeInvoices, paypalInvoices] = await Promise.all([
      this.invoicesForCustomer(user?.stripeCustomerId ?? null),
      this.paypalInvoicesForUser(userId),
    ]);
    return [...stripeInvoices, ...paypalInvoices].sort(
      (a, b) => Date.parse(b.created) - Date.parse(a.created),
    );
  }

  // ---------- Admin: per-member billing + one-click actions ----------

  async getMemberBilling(memberId: string): Promise<MemberBillingDTO> {
    const user = await this.prisma.user.findUnique({ where: { id: memberId } });
    if (!user) throw new NotFoundException('Member not found');
    // Safety net: reconcile the member's live Stripe subscriptions inline so the
    // admin always sees current grants (and the purchase notification fires) even
    // when no Stripe webhook ran and the post-checkout sync didn't fire. Wrapped
    // so a Stripe hiccup can never break the billing page.
    if (user.stripeCustomerId) {
      try {
        await this.reconcileCustomer(user.stripeCustomerId, 'adminview');
      } catch (err) {
        this.logger.warn(
          `[getMemberBilling] reconcile failed for ${memberId}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }
    // Same safety net for PayPal: re-fetch each known subscription so the page
    // is current even when webhooks can't reach this environment.
    try {
      await this.refreshPayPalSubsForUser(user.id, 'adminview');
    } catch (err) {
      this.logger.warn(
        `[getMemberBilling] paypal refresh failed for ${memberId}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
    await this.sweepExpiredPayPalGrants(user.id);
    const [stripeSubs, paypalSubs, stripeInvoices, paypalInvoices, lifetimeRows] =
      await Promise.all([
        this.detailsForCustomer(user.stripeCustomerId),
        this.paypalDetailsForUser(user.id),
        this.invoicesForCustomer(user.stripeCustomerId),
        this.paypalInvoicesForUser(user.id),
        this.prisma.userLevel.findMany({
          where: { userId: user.id, lifetime: true },
          include: { level: { select: { name: true } } },
        }),
      ]);
    return {
      member: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
      subscriptions: [...stripeSubs, ...paypalSubs],
      invoices: [...stripeInvoices, ...paypalInvoices].sort(
        (a, b) => Date.parse(b.created) - Date.parse(a.created),
      ),
      lifetimeLevels: lifetimeRows.map((ul) => ({
        levelId: ul.levelId,
        levelName: ul.level.name,
      })),
    };
  }

  // Retrieve a subscription and assert it belongs to this member. Admin actions
  // target a SPECIFIC subscription id (from the member's billing page), so each
  // row acts on its own subscription rather than "the member's first live sub".
  private async memberSub(
    memberId: string,
    subId: string,
  ): Promise<Stripe.Subscription> {
    const user = await this.prisma.user.findUnique({ where: { id: memberId } });
    if (!user?.stripeCustomerId) {
      throw new BadRequestException('Member has no Stripe customer');
    }
    const sub = await this.stripe.retrieveSubscription(subId);
    const customerId =
      typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
    if (customerId !== user.stripeCustomerId) {
      throw new NotFoundException('Subscription not found for this member');
    }
    return sub;
  }

  // Pause ONE subscription: stop billing AND suspend access (Stripe
  // pause_collection / PayPal suspend). Reconciling inline flips the grant to
  // PAUSED immediately (no webhook needed).
  async pauseSub(memberId: string, subId: string): Promise<MemberBillingDTO> {
    if ((await this.providerForSub(subId)) === 'PAYPAL') {
      await this.memberPayPalSub(memberId, subId);
      await this.paypal.suspendSubscription(subId, 'Paused by site admin');
      const after = await this.paypal.getSubscription(subId);
      await this.reconcilePayPalSubscription(after, `admin:pause:${subId}`);
    } else {
      await this.memberSub(memberId, subId);
      const sub = await this.stripe.pauseSubscription(subId);
      await this.reconcileSubscription(sub, `admin:pause:${subId}`);
    }
    return this.getMemberBilling(memberId);
  }

  // Resume a PAUSED subscription: clear the pause and restore access. Never
  // un-cancels (Stripe: only pause_collection is cleared; PayPal: activate
  // fails on a CANCELLED subscription).
  async resumeSub(memberId: string, subId: string): Promise<MemberBillingDTO> {
    if ((await this.providerForSub(subId)) === 'PAYPAL') {
      await this.memberPayPalSub(memberId, subId);
      await this.paypal.activateSubscription(subId, 'Resumed by site admin');
      const after = await this.paypal.getSubscription(subId);
      await this.reconcilePayPalSubscription(after, `admin:resume:${subId}`);
    } else {
      await this.memberSub(memberId, subId);
      const sub = await this.stripe.resumeSubscription(subId);
      await this.reconcileSubscription(sub, `admin:resume:${subId}`);
    }
    return this.getMemberBilling(memberId);
  }

  // Cancel ONE subscription. `immediate` ends billing AND access now;
  // `period_end` stops the renewal but keeps access until the paid period ends
  // (Stripe auto-cancels then; PayPal cancels NOW and our grant carries the
  // grace expiry). Cancellation is final — there is no resume.
  async cancelSub(
    memberId: string,
    subId: string,
    mode: 'immediate' | 'period_end',
  ): Promise<MemberBillingDTO> {
    if ((await this.providerForSub(subId)) === 'PAYPAL') {
      await this.memberPayPalSub(memberId, subId);
      if (mode === 'immediate') {
        await this.paypal.cancelSubscription(subId, 'Canceled by site admin');
        const after = await this.paypal.getSubscription(subId);
        await this.reconcilePayPalSubscription(
          after,
          `admin:cancel:immediate:${subId}`,
        );
      } else {
        await this.schedulePayPalPeriodEndCancel(
          memberId,
          subId,
          `admin:cancel:period_end:${subId}`,
        );
      }
    } else {
      await this.memberSub(memberId, subId);
      const sub =
        mode === 'immediate'
          ? await this.stripe.cancelSubscription(subId)
          : await this.stripe.setCancelAtPeriodEnd(subId, true);
      await this.reconcileSubscription(sub, `admin:cancel:${mode}:${subId}`);
    }
    return this.getMemberBilling(memberId);
  }

  // Member self-service cancellation: ALWAYS at period end — the member keeps the
  // access they've already paid for and billing simply won't renew. (Immediate
  // cancel stays an admin-only action.) Ownership is enforced per provider.
  async cancelMyMembership(
    userId: string,
    subId: string,
  ): Promise<SubscriptionDetailDTO[]> {
    if ((await this.providerForSub(subId)) === 'PAYPAL') {
      await this.memberPayPalSub(userId, subId);
      await this.schedulePayPalPeriodEndCancel(
        userId,
        subId,
        `member:cancel:${subId}`,
      );
    } else {
      await this.memberSub(userId, subId);
      const sub = await this.stripe.setCancelAtPeriodEnd(subId, true);
      await this.reconcileSubscription(sub, `member:cancel:${subId}`);
    }
    return this.getMySubscriptionDetails(userId);
  }

  // ---------- Webhook ----------

  /**
   * Verify the signature, then dispatch. Handlers are idempotent: they upsert
   * the SubscriptionMirror and reconcile UserLevel(source=STRIPE) rows from the
   * subscription's live items, so duplicate/out-of-order events converge.
   */
  async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    const webhookSecret = await this.stripe.getWebhookSecret();
    if (!webhookSecret) {
      throw new BadRequestException('Stripe webhook secret not configured');
    }
    let event: Stripe.Event;
    try {
      event = await this.stripe.constructEvent(rawBody, signature, webhookSecret);
    } catch (err) {
      this.logger.warn(
        `[stripe-webhook] signature_fail err=${err instanceof Error ? err.message : String(err)}`,
      );
      throw new BadRequestException('Invalid signature');
    }

    // Single audit line per event lets ops correlate Stripe's dashboard
    // event log with our processing (id + type + outcome + duration).
    const t0 = Date.now();
    this.logger.log(`[stripe-webhook] start id=${event.id} type=${event.type}`);

    try {
      switch (event.type) {
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted':
          await this.reconcileSubscription(
            event.data.object as Stripe.Subscription,
            event.id,
          );
          break;
        case 'invoice.paid':
        case 'invoice.payment_failed': {
          const invoice = event.data.object as Stripe.Invoice;
          const subId =
            typeof invoice.subscription === 'string'
              ? invoice.subscription
              : invoice.subscription?.id;
          if (subId) {
            // Re-fetch the canonical subscription to reconcile from source of truth.
            const sub = await this.stripe.retrieveSubscription(subId);
            await this.reconcileSubscription(sub, event.id);
            // Admin notification for the payment itself (keyed by invoice id).
            await this.notifyInvoiceEvent(event.type, invoice, sub);
            // On a successful payment, check whether an installment plan has now
            // been paid in full -> convert to lifetime + stop billing.
            if (event.type === 'invoice.paid') {
              await this.fulfillInstallmentsIfComplete(sub, invoice.id);
            }
          }
          break;
        }
        default:
          this.logger.log(
            `[stripe-webhook] unhandled id=${event.id} type=${event.type} duration_ms=${Date.now() - t0}`,
          );
          return;
      }
      this.logger.log(
        `[stripe-webhook] ok id=${event.id} type=${event.type} duration_ms=${Date.now() - t0}`,
      );
    } catch (err) {
      // Stripe retries on non-2xx, so rethrowing is intentional. The log
      // here captures the failure with full context before Stripe re-sends.
      this.logger.error(
        `[stripe-webhook] error id=${event.id} type=${event.type} duration_ms=${Date.now() - t0} err=${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err;
    }
  }

  /**
   * Reconcile a single Stripe subscription into the local mirror + UserLevels.
   * Thin mapper: resolves the local user + items from the Stripe shape, then
   * the provider-neutral applySubscriptionState does the actual work (mirror,
   * grants, Mailchimp transitions, notifications). Values are mapped exactly
   * as the pre-extraction implementation did.
   */
  private async reconcileSubscription(
    sub: Stripe.Subscription,
    sourceEventId?: string,
  ): Promise<void> {
    const customerId =
      typeof sub.customer === 'string' ? sub.customer : sub.customer.id;

    const user = await this.prisma.user.findUnique({
      where: { stripeCustomerId: customerId },
    });
    if (!user) {
      this.logger.warn(
        `No local user for Stripe customer ${customerId}; skipping`,
      );
      return;
    }

    const { sub: subStatus, userLevel: levelStatus } = mapSubStatus(sub.status);
    // pause_collection suspends access everywhere (resumable). Surface it as a
    // distinct PAUSED status rather than leaving the subscription "active".
    const paused = sub.pause_collection != null;

    // Map each subscription item's price -> our Level.
    const items: NormalizedSubItem[] = [];
    for (const item of sub.items?.data ?? []) {
      const stripePriceId =
        typeof item.price === 'string' ? item.price : item.price?.id;
      if (!stripePriceId) continue;
      const price = await this.prisma.price.findUnique({
        where: { stripePriceId },
        include: { level: true },
      });
      if (!price) {
        this.logger.warn(`No local Price for ${stripePriceId}; skipping item`);
        continue;
      }
      items.push({
        levelId: price.levelId,
        levelName: price.level.name,
        subItemId: item.id,
        audienceTags: price.level.audienceTags,
        audienceId: price.level.audienceId,
      });
    }

    await this.applySubscriptionState(
      {
        provider: 'STRIPE',
        externalSubId: sub.id,
        externalCustomerId: customerId,
        user: { id: user.id, email: user.email },
        subStatus: paused ? 'PAUSED' : subStatus,
        userLevelStatus: paused ? 'PAUSED' : levelStatus,
        currentPeriodEnd: sub.current_period_end
          ? new Date(sub.current_period_end * 1000)
          : null,
        cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
        items,
        graceExpiresAt: null,
        mirrorPriceId: null,
        periodKey: sub.current_period_end ?? 'na',
      },
      sourceEventId,
    );
  }

  /**
   * Provider-neutral reconcile core (extracted verbatim from the Stripe-only
   * implementation so PayPal reuses identical semantics):
   * - Upsert SubscriptionMirror (provider + index columns included).
   * - For each normalized item, upsert a UserLevel(source=provider) with the
   *   mapped status; never downgrade lifetime grants.
   * - Any same-source UserLevel tied to THIS subscription's items that is no
   *   longer present is marked CANCELED (other subscriptions are untouched).
   * - Enqueue Mailchimp tag add/remove per level transition (pause keeps tags).
   * - Emit admin notifications once per genuine lifecycle transition.
   * The PayPal grace path (graceExpiresAt) keeps the grant ACTIVE with an
   * expiry while the mirror records the terminal status for the sweep.
   */
  private async applySubscriptionState(
    s: NormalizedSubState,
    sourceEventId?: string,
  ): Promise<void> {
    const user = s.user;
    const subStatusFinal = s.subStatus;
    const grace = s.graceExpiresAt != null;
    const periodEnd = s.currentPeriodEnd;

    // Capture the prior mirror BEFORE the upsert so lifecycle notifications fire
    // only on a genuine transition (this also makes webhook replays no-ops).
    const prevMirror = await this.prisma.subscriptionMirror.findUnique({
      where: { stripeSubId: s.externalSubId },
    });

    await this.prisma.subscriptionMirror.upsert({
      where: { stripeSubId: s.externalSubId },
      create: {
        provider: s.provider,
        stripeSubId: s.externalSubId,
        stripeCustomerId: s.externalCustomerId,
        userId: user.id,
        priceId: s.mirrorPriceId,
        status: subStatusFinal,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: s.cancelAtPeriodEnd,
      },
      update: {
        provider: s.provider,
        stripeCustomerId: s.externalCustomerId,
        userId: user.id,
        priceId: s.mirrorPriceId ?? undefined,
        status: subStatusFinal,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: s.cancelAtPeriodEnd,
      },
    });

    // Item ids on THIS subscription — used to scope cancellation so we never
    // touch grants that belong to the user's OTHER subscriptions.
    const thisSubItemIds = new Set(s.items.map((i) => i.subItemId));
    const desired = new Map<string, NormalizedSubItem>();
    for (const item of s.items) desired.set(item.levelId, item);
    // Human-readable level names for this subscription, for notification bodies.
    const levelNames = s.items.map((i) => i.levelName);

    // Existing same-source grants for this user.
    const existing = await this.prisma.userLevel.findMany({
      where: { userId: user.id, source: s.provider },
      include: { level: true },
    });
    const existingByLevel = new Map(existing.map((ul) => [ul.levelId, ul]));

    // Upsert desired levels.
    for (const [levelId, info] of desired) {
      const prev = existingByLevel.get(levelId);
      // Never downgrade a lifetime grant (a paid-in-full installment plan stays
      // ACTIVE forever, even as its now-cancelled subscription reconciles). The
      // grace path likewise keeps access ACTIVE until the paid period ends.
      const statusForRow = prev?.lifetime
        ? 'ACTIVE'
        : grace
          ? 'ACTIVE'
          : s.userLevelStatus;
      const expiresForRow = grace ? s.graceExpiresAt : periodEnd;
      await this.prisma.userLevel.upsert({
        where: {
          userId_levelId_source: {
            userId: user.id,
            levelId,
            source: s.provider,
          },
        },
        create: {
          userId: user.id,
          levelId,
          source: s.provider,
          status: statusForRow,
          stripeSubItemId: info.subItemId,
          expiresAt: expiresForRow,
        },
        update: {
          status: statusForRow,
          stripeSubItemId: info.subItemId,
          expiresAt: prev?.lifetime ? null : expiresForRow,
        },
      });

      // Audience/tag sync: add when newly active, remove when transitioning to
      // non-active — but NOT for a mere pause (keep tags during a pause so a
      // temporary suspension doesn't churn the audience).
      const wasActive = prev?.status === 'ACTIVE';
      const nowActive = statusForRow === 'ACTIVE';
      if (nowActive && !wasActive) {
        // ALWAYS capture the member into the class's in-house audience on a
        // newly-active grant (null audienceId → default "Members"). syncTags
        // upserts the contact first, so it lands them even with empty tags.
        // Best-effort.
        try {
          await this.contacts.syncTags(
            'add',
            user.email,
            info.audienceTags,
            info.audienceId ?? undefined,
          );
        } catch (err) {
          this.logger.warn(
            `[billing] contacts add-tags failed for ${user.email}: ${
              err instanceof Error ? err.message : err
            }`,
          );
        }
        // Mirror tags to Mailchimp (gated/no-op by default). Pass undefined for
        // the audience — Mailchimp wants a LIST id, not our internal Audience
        // id. Only enqueue when there are tags to apply.
        if (info.audienceTags.length) {
          await this.mailchimp.enqueueTags(
            'add',
            user.email,
            info.audienceTags,
            undefined,
          );
        }
      } else if (!nowActive && wasActive && statusForRow !== 'PAUSED') {
        await this.maybeRemoveTags(
          user.id,
          levelId,
          user.email,
          info.audienceTags,
          info.audienceId ?? undefined,
        );
      }
    }

    // Items removed FROM THIS subscription -> CANCELED, EXCEPT lifetime grants
    // (a completed installment plan), which are permanent. We only revoke grants
    // tied to THIS subscription's items: each class is its own provider
    // subscription, so a grant from a DIFFERENT subscription must not be
    // cancelled here.
    for (const ul of existing) {
      if (desired.has(ul.levelId)) continue;
      if (ul.lifetime) continue;
      if (!ul.stripeSubItemId || !thisSubItemIds.has(ul.stripeSubItemId)) {
        continue; // belongs to another subscription — leave it alone
      }
      await this.prisma.userLevel.update({
        where: { id: ul.id },
        data: { status: 'CANCELED' },
      });
      if (ul.level.audienceTags.length && ul.status === 'ACTIVE') {
        await this.maybeRemoveTags(
          user.id,
          ul.levelId,
          user.email,
          ul.level.audienceTags,
          ul.level.audienceId ?? undefined,
        );
      }
    }

    // ---- Admin notifications: emit ONCE per genuine lifecycle transition ----
    // prevMirror vs the new values gates against replays/re-reconciles; the
    // unique dedupeKey is a backstop. Payment failures are emitted from the
    // invoice branch (not here), so PAST_DUE intentionally produces no event.
    const planLabel = levelNames.length ? levelNames.join(', ') : 'subscription';
    const prevStatus = prevMirror?.status ?? null;
    const prevCancelAtPe = prevMirror?.cancelAtPeriodEnd ?? false;
    const newCancelAtPe = s.cancelAtPeriodEnd;
    const periodKey = s.periodKey;

    if (
      prevMirror == null &&
      (subStatusFinal === 'ACTIVE' || subStatusFinal === 'TRIALING')
    ) {
      await this.notify({
        type: 'SUBSCRIPTION_CREATED',
        severity: 'INFO',
        title: 'New subscription',
        body: `${user.email} subscribed to ${planLabel}`,
        userId: user.id,
        dedupeKey: `sub:created:${s.externalSubId}`,
      });
      // Member-facing automation: gated by the same `prevMirror == null`
      // genuine-activation condition as the admin notification, so a webhook
      // replay / re-reconcile won't re-fire it (fire()'s dedupeKey is a backstop).
      await this.fireSubscriptionAutomation('SUBSCRIPTION_ACTIVE', user, planLabel);
    }
    if (prevStatus !== 'PAUSED' && subStatusFinal === 'PAUSED') {
      await this.notify({
        type: 'SUBSCRIPTION_PAUSED',
        severity: 'WARNING',
        title: 'Subscription paused',
        body: `${user.email} — ${planLabel} is on hold`,
        userId: user.id,
        dedupeKey: `sub:paused:${s.externalSubId}:${sourceEventId ?? periodKey}`,
      });
    }
    if (
      prevStatus === 'PAUSED' &&
      subStatusFinal !== 'PAUSED' &&
      subStatusFinal !== 'CANCELED'
    ) {
      await this.notify({
        type: 'SUBSCRIPTION_RESUMED',
        severity: 'INFO',
        title: 'Subscription resumed',
        body: `${user.email} — ${planLabel} resumed`,
        userId: user.id,
        dedupeKey: `sub:resumed:${s.externalSubId}:${sourceEventId ?? periodKey}`,
      });
    }
    if (prevStatus !== 'CANCELED' && subStatusFinal === 'CANCELED') {
      await this.notify({
        type: 'SUBSCRIPTION_CANCELED',
        severity: 'CRITICAL',
        title: 'Subscription canceled',
        body: grace
          ? `${user.email} — ${planLabel} canceled (access until the period end)`
          : `${user.email} — ${planLabel} canceled`,
        userId: user.id,
        dedupeKey: `sub:canceled:${s.externalSubId}`,
      });
      // Member-facing automation: same `prevStatus !== 'CANCELED'` gate as the
      // admin notification means a re-reconcile of an already-canceled sub won't
      // re-fire. Covers BOTH cancel paths (admin cancelSub + member
      // cancelMyMembership), since both funnel through reconcile -> here.
      await this.fireSubscriptionAutomation('SUBSCRIPTION_CANCELED', user, planLabel);
    }
    if (!prevCancelAtPe && newCancelAtPe && subStatusFinal !== 'CANCELED') {
      await this.notify({
        type: 'SUBSCRIPTION_CANCEL_SCHEDULED',
        severity: 'WARNING',
        title: 'Cancellation scheduled',
        body: `${user.email} — ${planLabel} will cancel at the period end`,
        userId: user.id,
        dedupeKey: `sub:cancel_scheduled:${s.externalSubId}`,
      });
    }
  }

  // Only remove tags if the user has no OTHER active grant for the level (e.g. a
  // manual grant), keeping audience state consistent. `audienceRef` is the
  // class's INTERNAL Audience id (null/undefined → default "Members"): it keys
  // the in-house syncTags only. Mailchimp expects a LIST id, never an internal
  // Audience id, so its enqueueTags gets undefined (global Settings fallback);
  // gated/no-op by default anyway.
  private async maybeRemoveTags(
    userId: string,
    levelId: string,
    email: string,
    tags: string[],
    audienceRef?: string,
  ): Promise<void> {
    const stillActive = await this.prisma.userLevel.count({
      where: { userId, levelId, status: 'ACTIVE' },
    });
    if (stillActive === 0) {
      await this.mailchimp.enqueueTags('remove', email, tags, undefined);
      // In-house list dual-write (best-effort).
      try {
        await this.contacts.syncTags('remove', email, tags, audienceRef);
      } catch (err) {
        this.logger.warn(
          `[billing] contacts remove-tags failed for ${email}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }
  }

  // ---------- Installments -> lifetime ----------

  /**
   * On a paid invoice, check whether an installment plan has been paid in full.
   * Once paid invoices >= Price.installments, convert the grant to lifetime
   * (UserLevel.lifetime = true, ACTIVE, no expiry) and cancel the Stripe
   * subscription so it never bills again — the member keeps access via the
   * lifetime grant. Idempotent: re-running just re-asserts the grant.
   */
  private async fulfillInstallmentsIfComplete(
    sub: Stripe.Subscription,
    currentInvoiceId: string | null,
  ): Promise<void> {
    const customerId =
      typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
    const user = await this.prisma.user.findUnique({
      where: { stripeCustomerId: customerId },
    });
    if (!user) return;

    for (const item of sub.items?.data ?? []) {
      const stripePriceId =
        typeof item.price === 'string' ? item.price : item.price?.id;
      if (!stripePriceId) continue;
      const price = await this.prisma.price.findUnique({
        where: { stripePriceId },
        include: { level: true },
      });
      if (!price || price.installments == null) continue;

      // Count paid invoices for this subscription; make sure the invoice that
      // triggered this event is counted (guards a read-after-write off-by-one).
      const paid = await this.stripe.listSubscriptionInvoices(sub.id, 'paid');
      const ids = new Set(paid.map((i) => i.id));
      if (currentInvoiceId) ids.add(currentInvoiceId);
      if (ids.size < price.installments) continue;

      await this.prisma.userLevel.upsert({
        where: {
          userId_levelId_source: {
            userId: user.id,
            levelId: price.levelId,
            source: 'STRIPE',
          },
        },
        create: {
          userId: user.id,
          levelId: price.levelId,
          source: 'STRIPE',
          status: 'ACTIVE',
          lifetime: true,
          stripeSubItemId: item.id,
          expiresAt: null,
        },
        update: { status: 'ACTIVE', lifetime: true, expiresAt: null },
      });
      this.logger.log(
        `[installments] sub=${sub.id} level=${price.levelId} paid ${ids.size}/${price.installments} -> lifetime granted user=${user.id}`,
      );

      await this.notify({
        type: 'INSTALLMENT_PLAN_COMPLETED',
        severity: 'INFO',
        title: 'Installment plan completed',
        body: `${user.email} — ${price.level.name} paid in full (lifetime access granted)`,
        userId: user.id,
        dedupeKey: `installment:complete:${sub.id}:${price.levelId}`,
      });

      // Stop billing. The resulting customer.subscription.deleted reconciles,
      // and its revoke step skips the now-lifetime grant.
      if (sub.status !== 'canceled') {
        try {
          await this.stripe.cancelSubscription(sub.id);
        } catch (err) {
          this.logger.warn(
            `[installments] post-fulfillment cancel failed sub=${sub.id}: ${
              err instanceof Error ? err.message : err
            }`,
          );
        }
      }
    }
  }

  // ====================================================================
  // PayPal (Subscriptions v1). The provider-neutral reconcile core above
  // does all grant/mirror/notification work — everything here is mapping,
  // checkout plumbing and webhook dispatch.
  // ====================================================================

  // Resolve a checkout price by its wire identifier: a Stripe price id
  // (price_…) or the local Price.id — the provider-neutral form the web sends.
  private async findPriceByWireId(
    priceId: string,
  ): Promise<PriceWithLevel | null> {
    const byStripe = await this.prisma.price.findUnique({
      where: { stripePriceId: priceId },
      include: { level: true },
    });
    if (byStripe) return byStripe;
    return this.prisma.price.findUnique({
      where: { id: priceId },
      include: { level: true },
    });
  }

  // A Stripe checkout for a price born under a PayPal-only configuration:
  // backfill the Stripe product/price lazily (symmetric to ensurePayPalPlan).
  private async ensureStripePrice(price: PriceWithLevel): Promise<string> {
    if (price.stripePriceId) return price.stripePriceId;
    let productId = price.level.stripeProductId;
    if (!productId) {
      const product = await this.stripe.createProduct(price.level.name);
      productId = product.id;
      await this.prisma.level.update({
        where: { id: price.levelId },
        data: { stripeProductId: productId },
      });
    }
    const stripePrice = await this.stripe.createPrice({
      productId,
      interval: price.interval as 'month' | 'year',
      amount: price.amount,
      currency: price.currency,
    });
    await this.prisma.price.update({
      where: { id: price.id },
      data: { stripePriceId: stripePrice.id },
    });
    return stripePrice.id;
  }

  // Lazily provision the PayPal catalog product + billing plan for a price.
  // Plans are environment-scoped; a clientId/mode change clears the stored ids
  // (settings controller) and they re-create here on the next checkout.
  private async ensurePayPalPlan(price: PriceWithLevel): Promise<string> {
    if (price.paypalPlanId) return price.paypalPlanId;
    let productId = price.level.paypalProductId;
    if (!productId) {
      productId = await this.paypal.ensureProduct(price.level.name);
      await this.prisma.level.update({
        where: { id: price.levelId },
        data: { paypalProductId: productId },
      });
    }
    const label =
      price.installments != null
        ? `${price.level.name} — ${price.installments} payments`
        : `${price.level.name} (${price.interval === 'year' ? 'yearly' : 'monthly'})`;
    const planId = await this.paypal.createPlan({
      productId,
      name: label,
      interval: price.interval as 'month' | 'year',
      amount: price.amount,
      currency: price.currency,
      installments: price.installments,
    });
    await this.prisma.price.update({
      where: { id: price.id },
      data: { paypalPlanId: planId },
    });
    return planId;
  }

  // Checkout step 1: make sure the plan exists and hand the browser what the
  // PayPal Buttons need. custom_id ties the approval back to the member.
  async paypalPrepare(
    userId: string,
    priceId: string,
  ): Promise<{ planId: string; customId: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const price = await this.findPriceByWireId(priceId);
    if (!price || !price.active) {
      throw new NotFoundException('This plan is not available');
    }
    const existingPaid = await this.prisma.userLevel.findFirst({
      where: {
        userId: user.id,
        levelId: price.levelId,
        source: { in: ['STRIPE', 'PAYPAL'] },
        status: { in: ['ACTIVE', 'PAST_DUE'] },
      },
    });
    if (existingPaid) {
      throw new BadRequestException(
        'You already have an active subscription to this class. Manage it from your account.',
      );
    }
    const planId = await this.ensurePayPalPlan(price);
    return { planId, customId: user.id };
  }

  // Checkout step 2 (after Buttons onApprove): verify the subscription really
  // belongs to this member + one of our plans, then grant access inline. Also
  // the manual reconcile fallback when webhooks can't reach this environment —
  // safe to call repeatedly for the same subscription.
  async paypalActivate(
    userId: string,
    subscriptionId: string,
  ): Promise<SubscriptionDetailDTO[]> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    let sub: PayPalSubscription;
    try {
      sub = await this.paypal.getSubscription(subscriptionId);
    } catch {
      throw new NotFoundException('Subscription not found');
    }
    // Don't leak other people's subscription state — same 404 as unknown ids.
    if (sub.custom_id !== user.id) {
      throw new NotFoundException('Subscription not found');
    }
    const price = await this.prisma.price.findUnique({
      where: { paypalPlanId: sub.plan_id },
      include: { level: true },
    });
    if (!price) {
      throw new BadRequestException('This subscription is not for a known plan');
    }
    // Double-approval guard: PayPal bills at approval, so a second live
    // subscription for the same class is a real double-charge. Cancel the
    // newcomer and tell the admin — the refund itself stays a human decision.
    const duplicate = await this.prisma.userLevel.findFirst({
      where: {
        userId: user.id,
        levelId: price.levelId,
        source: { in: ['STRIPE', 'PAYPAL'] },
        status: { in: ['ACTIVE', 'PAST_DUE'] },
        NOT: { stripeSubItemId: sub.id },
      },
    });
    if (duplicate) {
      try {
        await this.paypal.cancelSubscription(
          sub.id,
          'Duplicate subscription for an already-held class',
        );
      } catch (err) {
        this.logger.error(
          `[paypal] duplicate cancel failed sub=${sub.id}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
      await this.notify({
        type: 'SUBSCRIPTION_CANCELED',
        severity: 'CRITICAL',
        title: 'Duplicate PayPal subscription canceled',
        body: `${user.email} approved a second PayPal subscription for ${price.level.name} — it was canceled automatically; check whether a refund is due (${sub.id})`,
        userId: user.id,
        dedupeKey: `pp:dup:${sub.id}`,
      });
      throw new BadRequestException(
        'You already have an active subscription to this class. The duplicate PayPal subscription was canceled.',
      );
    }
    await this.reconcilePayPalSubscription(sub, `activate:${sub.id}`);
    return this.getMySubscriptionDetails(userId);
  }

  // Which processor owns a subscription id — mirror first, id-shape fallback
  // for a sub that hasn't been mirrored yet (PayPal ids are "I-…").
  private async providerForSub(subId: string): Promise<'STRIPE' | 'PAYPAL'> {
    const mirror = await this.prisma.subscriptionMirror.findUnique({
      where: { stripeSubId: subId },
    });
    if (mirror) return mirror.provider;
    return subId.startsWith('I-') ? 'PAYPAL' : 'STRIPE';
  }

  // PayPal sibling of memberSub: fetch + assert ownership via custom_id.
  private async memberPayPalSub(
    memberId: string,
    subId: string,
  ): Promise<PayPalSubscription> {
    let sub: PayPalSubscription | null = null;
    try {
      sub = await this.paypal.getSubscription(subId);
    } catch {
      sub = null;
    }
    if (!sub || sub.custom_id !== memberId) {
      throw new NotFoundException('Subscription not found for this member');
    }
    return sub;
  }

  // "Cancel at period end" for PayPal, which only cancels immediately. The
  // ORDER is the point: (1) record the intent on the mirror so the CANCELLED
  // webhook is grace-aware no matter when it arrives, (2) cancel at PayPal,
  // (3) reconcile — the grant stays ACTIVE with expiresAt = the period end,
  // and the sweep flips it once the paid time runs out.
  private async schedulePayPalPeriodEndCancel(
    userId: string,
    subId: string,
    tag: string,
  ): Promise<void> {
    const sub = await this.paypal.getSubscription(subId);
    const price = await this.prisma.price.findUnique({
      where: { paypalPlanId: sub.plan_id },
    });
    const periodEnd = sub.billing_info?.next_billing_time
      ? new Date(sub.billing_info.next_billing_time)
      : null;
    const mapped = this.mapPayPalStatus(sub.status);
    await this.prisma.subscriptionMirror.upsert({
      where: { stripeSubId: subId },
      create: {
        provider: 'PAYPAL',
        stripeSubId: subId,
        stripeCustomerId: sub.subscriber?.payer_id ?? 'paypal',
        userId,
        priceId: price?.id ?? null,
        status: mapped.sub,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: true,
      },
      update: {
        cancelAtPeriodEnd: true,
        ...(periodEnd ? { currentPeriodEnd: periodEnd } : {}),
      },
    });
    await this.paypal.cancelSubscription(
      subId,
      'Canceled — access continues until the paid period ends',
    );
    const after = await this.paypal.getSubscription(subId);
    await this.reconcilePayPalSubscription(after, tag);
  }

  // PayPal subscription status -> our SubStatus / UserLevelStatus.
  private mapPayPalStatus(status: PayPalSubscription['status']): {
    sub: NormalizedSubState['subStatus'];
    userLevel: NormalizedSubState['userLevelStatus'];
  } {
    switch (status) {
      case 'ACTIVE':
        return { sub: 'ACTIVE', userLevel: 'ACTIVE' };
      case 'SUSPENDED':
        return { sub: 'PAUSED', userLevel: 'PAUSED' };
      case 'CANCELLED':
        return { sub: 'CANCELED', userLevel: 'CANCELED' };
      case 'EXPIRED':
        // total_cycles ran out. Installment plans convert to lifetime (see
        // fulfillPayPalInstallmentsIfComplete); anything else simply ends.
        return { sub: 'CANCELED', userLevel: 'CANCELED' };
      case 'APPROVAL_PENDING':
      case 'APPROVED':
      default:
        // Approved-but-not-billed mirrors Stripe's incomplete: no access yet.
        return { sub: 'INCOMPLETE', userLevel: 'EXPIRED' };
    }
  }

  /**
   * Reconcile a single PayPal subscription. Mapper only — user via custom_id,
   * price via plan_id, single item (PayPal subs carry exactly one plan), then
   * the shared applySubscriptionState does grants/mirror/notifications.
   * `forcePastDue` covers BILLING.SUBSCRIPTION.PAYMENT.FAILED, where PayPal
   * keeps the subscription ACTIVE and the event is the only dunning signal.
   */
  private async reconcilePayPalSubscription(
    sub: PayPalSubscription,
    sourceEventId?: string,
    opts?: { forcePastDue?: boolean },
  ): Promise<void> {
    const userId = sub.custom_id;
    if (!userId) {
      this.logger.warn(`[paypal] sub ${sub.id} has no custom_id; skipping`);
      return;
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      this.logger.warn(
        `[paypal] no local user ${userId} for sub ${sub.id}; skipping`,
      );
      return;
    }
    const price = await this.prisma.price.findUnique({
      where: { paypalPlanId: sub.plan_id },
      include: { level: true },
    });
    if (!price) {
      this.logger.warn(
        `[paypal] no local Price for plan ${sub.plan_id}; skipping`,
      );
      return;
    }

    let { sub: subStatus, userLevel: levelStatus } = this.mapPayPalStatus(
      sub.status,
    );
    if (opts?.forcePastDue && subStatus === 'ACTIVE') {
      subStatus = 'PAST_DUE';
      levelStatus = 'PAST_DUE';
    }

    // next_billing_time disappears once a sub is cancelled — fall back to the
    // mirror so the grace window keeps its original end date.
    const mirror = await this.prisma.subscriptionMirror.findUnique({
      where: { stripeSubId: sub.id },
    });
    const periodEnd = sub.billing_info?.next_billing_time
      ? new Date(sub.billing_info.next_billing_time)
      : (mirror?.currentPeriodEnd ?? null);
    const graceEnd =
      sub.status === 'CANCELLED' &&
      mirror?.cancelAtPeriodEnd &&
      mirror.currentPeriodEnd &&
      mirror.currentPeriodEnd > new Date()
        ? mirror.currentPeriodEnd
        : null;

    await this.applySubscriptionState(
      {
        provider: 'PAYPAL',
        externalSubId: sub.id,
        externalCustomerId: sub.subscriber?.payer_id ?? 'paypal',
        user: { id: user.id, email: user.email },
        subStatus,
        userLevelStatus: levelStatus,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: mirror?.cancelAtPeriodEnd ?? false,
        items: [
          {
            levelId: price.levelId,
            levelName: price.level.name,
            subItemId: sub.id,
            audienceTags: price.level.audienceTags,
            audienceId: price.level.audienceId,
          },
        ],
        graceExpiresAt: graceEnd,
        mirrorPriceId: price.id,
        periodKey: sub.billing_info?.next_billing_time ?? 'na',
      },
      sourceEventId,
    );
  }

  // PayPal installments ride total_cycles: billing stops by itself after N
  // payments, so unlike Stripe there is no cancel call — just the lifetime
  // conversion once the Nth cycle completes (or the sub reports EXPIRED).
  private async fulfillPayPalInstallmentsIfComplete(
    sub: PayPalSubscription,
  ): Promise<void> {
    const userId = sub.custom_id;
    if (!userId) return;
    const price = await this.prisma.price.findUnique({
      where: { paypalPlanId: sub.plan_id },
      include: { level: true },
    });
    if (!price || price.installments == null) return;
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;

    const regular = sub.billing_info?.cycle_executions?.find(
      (c) => c.tenure_type === 'REGULAR',
    );
    const completed = regular?.cycles_completed ?? 0;
    if (sub.status !== 'EXPIRED' && completed < price.installments) return;

    await this.prisma.userLevel.upsert({
      where: {
        userId_levelId_source: {
          userId: user.id,
          levelId: price.levelId,
          source: 'PAYPAL',
        },
      },
      create: {
        userId: user.id,
        levelId: price.levelId,
        source: 'PAYPAL',
        status: 'ACTIVE',
        lifetime: true,
        stripeSubItemId: sub.id,
        expiresAt: null,
      },
      update: { status: 'ACTIVE', lifetime: true, expiresAt: null },
    });
    this.logger.log(
      `[paypal-installments] sub=${sub.id} level=${price.levelId} paid ${completed}/${price.installments} -> lifetime granted user=${user.id}`,
    );
    await this.notify({
      type: 'INSTALLMENT_PLAN_COMPLETED',
      severity: 'INFO',
      title: 'Installment plan completed',
      body: `${user.email} — ${price.level.name} paid in full (lifetime access granted)`,
      userId: user.id,
      dedupeKey: `installment:complete:${sub.id}:${price.levelId}`,
    });
  }

  /**
   * Verify + dispatch a PayPal webhook. Every handler re-fetches the canonical
   * subscription before reconciling, so out-of-order or replayed deliveries
   * converge; processing errors rethrow so PayPal retries (non-2xx).
   */
  async handlePayPalWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<void> {
    const verified = await this.paypal.verifyWebhookSignature(rawBody, headers);
    if (!verified) {
      throw new BadRequestException('Invalid PayPal webhook signature');
    }
    let event: {
      id?: string;
      event_type?: string;
      resource?: {
        id?: string;
        billing_agreement_id?: string;
        amount?: { total?: string; currency?: string };
      };
    };
    try {
      event = JSON.parse(rawBody.toString('utf8')) as typeof event;
    } catch {
      throw new BadRequestException('Invalid PayPal webhook payload');
    }
    const type = event.event_type ?? 'unknown';
    const eventId = event.id ?? 'unknown';
    const t0 = Date.now();
    this.logger.log(`[paypal-webhook] start id=${eventId} type=${type}`);

    try {
      switch (type) {
        case 'BILLING.SUBSCRIPTION.ACTIVATED':
        case 'BILLING.SUBSCRIPTION.UPDATED':
        case 'BILLING.SUBSCRIPTION.SUSPENDED':
        case 'BILLING.SUBSCRIPTION.CANCELLED': {
          const subId = event.resource?.id;
          if (!subId) break;
          const sub = await this.paypal.getSubscription(subId);
          await this.reconcilePayPalSubscription(sub, eventId);
          break;
        }
        case 'BILLING.SUBSCRIPTION.EXPIRED': {
          const subId = event.resource?.id;
          if (!subId) break;
          const sub = await this.paypal.getSubscription(subId);
          // Lifetime conversion FIRST so the reconcile's revoke logic sees a
          // lifetime grant and preserves it.
          await this.fulfillPayPalInstallmentsIfComplete(sub);
          await this.reconcilePayPalSubscription(sub, eventId);
          break;
        }
        case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED': {
          const subId = event.resource?.id;
          if (!subId) break;
          const sub = await this.paypal.getSubscription(subId);
          await this.reconcilePayPalSubscription(sub, eventId, {
            forcePastDue: true,
          });
          if (sub.custom_id) {
            const user = await this.prisma.user.findUnique({
              where: { id: sub.custom_id },
              select: { id: true, email: true },
            });
            if (user) {
              await this.notify({
                type: 'PAYMENT_FAILED',
                severity: 'CRITICAL',
                title: 'Payment failed',
                body: `${user.email} — PayPal payment failed`,
                userId: user.id,
                dedupeKey: `pp:payfail:${subId}:${eventId}`,
              });
            }
          }
          break;
        }
        case 'PAYMENT.SALE.COMPLETED': {
          // Sale events reference the subscription via billing_agreement_id.
          // Ignore sales that aren't tied to one of OUR PayPal subscriptions
          // (e.g. one-off PayPal payments on the same business account).
          const subId = event.resource?.billing_agreement_id;
          if (!subId) break;
          const mirror = await this.prisma.subscriptionMirror.findUnique({
            where: { stripeSubId: subId },
          });
          if (!mirror || mirror.provider !== 'PAYPAL') break;
          const sub = await this.paypal.getSubscription(subId);
          await this.reconcilePayPalSubscription(sub, eventId);
          await this.fulfillPayPalInstallmentsIfComplete(sub);
          // Renewal receipt notification; the FIRST payment is covered by
          // SUBSCRIPTION_CREATED (same suppression rule as Stripe invoices).
          const regular = sub.billing_info?.cycle_executions?.find(
            (c) => c.tenure_type === 'REGULAR',
          );
          if ((regular?.cycles_completed ?? 0) > 1 && sub.custom_id) {
            const user = await this.prisma.user.findUnique({
              where: { id: sub.custom_id },
              select: { id: true, email: true },
            });
            if (user) {
              const total = event.resource?.amount?.total;
              const amount = this.formatMoney(
                total ? Math.round(parseFloat(total) * 100) : null,
                event.resource?.amount?.currency,
              );
              await this.notify({
                type: 'PAYMENT_SUCCEEDED',
                severity: 'INFO',
                title: 'Payment received',
                body: `${user.email} — paid ${amount}`,
                userId: user.id,
                dedupeKey: `pp:paid:${event.resource?.id ?? eventId}`,
              });
            }
          }
          break;
        }
        default:
          this.logger.log(
            `[paypal-webhook] unhandled id=${eventId} type=${type} duration_ms=${Date.now() - t0}`,
          );
          return;
      }
      this.logger.log(
        `[paypal-webhook] ok id=${eventId} type=${type} duration_ms=${Date.now() - t0}`,
      );
    } catch (err) {
      this.logger.error(
        `[paypal-webhook] error id=${eventId} type=${type} duration_ms=${Date.now() - t0} err=${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err;
    }
  }

  // Distinct PayPal subscription ids a user holds grants for (the mirror is
  // the index — PayPal has no list-by-payer API).
  private async paypalSubIdsForUser(userId: string): Promise<string[]> {
    const grants = await this.prisma.userLevel.findMany({
      where: { userId, source: 'PAYPAL', stripeSubItemId: { not: null } },
      select: { stripeSubItemId: true },
    });
    return [...new Set(grants.map((g) => g.stripeSubItemId as string))];
  }

  // Inline refresh (admin view / fallback): re-fetch each known PayPal sub and
  // reconcile. Per-sub failures are logged, never thrown.
  private async refreshPayPalSubsForUser(
    userId: string,
    tag = 'refresh',
  ): Promise<void> {
    const subIds = await this.paypalSubIdsForUser(userId);
    await Promise.all(
      subIds.map(async (subId) => {
        try {
          const sub = await this.paypal.getSubscription(subId);
          await this.reconcilePayPalSubscription(sub, `${tag}:${subId}`);
        } catch (err) {
          this.logger.warn(
            `[paypal] refresh failed sub=${subId}: ${
              err instanceof Error ? err.message : err
            }`,
          );
        }
      }),
    );
  }

  // PayPal half of the member's subscription details. Live fetch per sub with
  // a mirror fallback — a PayPal outage degrades the row, never the page.
  private async paypalDetailsForUser(
    userId: string,
  ): Promise<SubscriptionDetailDTO[]> {
    const subIds = await this.paypalSubIdsForUser(userId);
    if (subIds.length === 0) return [];
    const [mirrors, results] = await Promise.all([
      this.prisma.subscriptionMirror.findMany({
        where: { stripeSubId: { in: subIds } },
      }),
      Promise.allSettled(subIds.map((id) => this.paypal.getSubscription(id))),
    ]);
    const mirrorById = new Map(mirrors.map((m) => [m.stripeSubId, m]));
    const priceIds = [
      ...new Set(
        mirrors.map((m) => m.priceId).filter((v): v is string => !!v),
      ),
    ];
    const prices = await this.prisma.price.findMany({
      where: { id: { in: priceIds } },
      include: { level: true },
    });
    const priceById = new Map(prices.map((p) => [p.id, p]));

    const out: SubscriptionDetailDTO[] = [];
    for (let i = 0; i < subIds.length; i++) {
      const subId = subIds[i];
      const mirror = mirrorById.get(subId);
      const price = mirror?.priceId ? priceById.get(mirror.priceId) : undefined;
      if (!mirror || !price) continue;
      const result = results[i];
      const live = result.status === 'fulfilled' ? result.value : null;

      // Normalized lowercase status (the DTO carries Stripe-style strings).
      const status: string = live
        ? live.status === 'SUSPENDED'
          ? 'paused'
          : live.status === 'CANCELLED' || live.status === 'EXPIRED'
            ? 'canceled'
            : live.status === 'ACTIVE'
              ? 'active'
              : 'incomplete'
        : mirror.status.toLowerCase();

      const now = new Date();
      const grace =
        mirror.cancelAtPeriodEnd &&
        mirror.currentPeriodEnd != null &&
        mirror.currentPeriodEnd > now;
      // Terminal and out of grace -> drop the row (Stripe details skip
      // canceled subscriptions the same way).
      if (status === 'canceled' && !grace) continue;

      const regular = live?.billing_info?.cycle_executions?.find(
        (c) => c.tenure_type === 'REGULAR',
      );
      out.push({
        stripeSubId: subId,
        provider: 'paypal',
        levelId: price.levelId,
        levelName: price.level.name,
        status: grace ? 'active' : status,
        interval: price.interval,
        amount: price.amount,
        currency: price.currency,
        currentPeriodEnd:
          live?.billing_info?.next_billing_time ??
          mirror.currentPeriodEnd?.toISOString() ??
          null,
        cancelAtPeriodEnd: mirror.cancelAtPeriodEnd,
        paused: status === 'paused',
        installmentsTotal: price.installments ?? null,
        installmentsPaid:
          price.installments != null
            ? (regular?.cycles_completed ?? null)
            : null,
      });
    }
    return out;
  }

  // PayPal payment history: per-subscription transactions mapped onto the
  // invoice DTO. No hosted receipt/PDF exists at PayPal — those stay null and
  // every consumer is already null-safe.
  private async paypalInvoicesForUser(userId: string): Promise<InvoiceDTO[]> {
    const subIds = (await this.paypalSubIdsForUser(userId)).slice(0, 10);
    if (subIds.length === 0) return [];
    const mirrors = await this.prisma.subscriptionMirror.findMany({
      where: { stripeSubId: { in: subIds } },
    });
    const priceIds = [
      ...new Set(
        mirrors.map((m) => m.priceId).filter((v): v is string => !!v),
      ),
    ];
    const prices = await this.prisma.price.findMany({
      where: { id: { in: priceIds } },
      include: { level: { select: { name: true } } },
    });
    const levelNameByPriceId = new Map(
      prices.map((p) => [p.id, p.level.name]),
    );
    const mirrorById = new Map(mirrors.map((m) => [m.stripeSubId, m]));

    const start = new Date(
      Date.now() - 3 * 365 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const end = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const results = await Promise.allSettled(
      subIds.map((id) => this.paypal.listTransactions(id, start, end)),
    );

    const out: InvoiceDTO[] = [];
    for (let i = 0; i < subIds.length; i++) {
      const result = results[i];
      if (result.status !== 'fulfilled') continue;
      const mirror = mirrorById.get(subIds[i]);
      const description = mirror?.priceId
        ? (levelNameByPriceId.get(mirror.priceId) ?? null)
        : null;
      for (const txn of result.value) {
        const gross = txn.amount_with_breakdown?.gross_amount;
        const cents = gross ? Math.round(parseFloat(gross.value) * 100) : 0;
        const paid = txn.status === 'COMPLETED';
        out.push({
          id: txn.id,
          number: null,
          created: txn.time,
          amountPaid: paid ? cents : 0,
          amountDue: cents,
          currency: (gross?.currency_code ?? 'usd').toLowerCase(),
          status: paid ? 'paid' : txn.status.toLowerCase(),
          description,
          hostedInvoiceUrl: null,
          invoicePdf: null,
        });
      }
    }
    return out;
  }

  /**
   * Grace-expiry sweep. PayPal period-end cancels leave the grant ACTIVE with
   * expiresAt = the paid period's end; once that passes, flip it to CANCELED
   * and run the Mailchimp removal — but ONLY when the mirror is already
   * CANCELED. A live subscription whose renewal webhook is merely late has an
   * ACTIVE mirror and is left alone, so this can never fight Stripe webhooks
   * (it is scoped to source=PAYPAL anyway).
   */
  private async sweepExpiredPayPalGrants(userId?: string): Promise<void> {
    if (this.sweeping && !userId) return; // overlap guard for the global tick
    if (!userId) this.sweeping = true;
    try {
      const rows = await this.prisma.userLevel.findMany({
        where: {
          source: 'PAYPAL',
          status: 'ACTIVE',
          lifetime: false,
          expiresAt: { lt: new Date() },
          stripeSubItemId: { not: null },
          ...(userId ? { userId } : {}),
        },
        include: {
          level: true,
          user: { select: { id: true, email: true } },
        },
      });
      for (const ul of rows) {
        const mirror = await this.prisma.subscriptionMirror.findUnique({
          where: { stripeSubId: ul.stripeSubItemId as string },
        });
        if (!mirror || mirror.status !== 'CANCELED') continue;
        await this.prisma.userLevel.update({
          where: { id: ul.id },
          data: { status: 'CANCELED' },
        });
        this.logger.log(
          `[paypal-sweep] grace expired sub=${ul.stripeSubItemId} level=${ul.levelId} user=${ul.userId} -> CANCELED`,
        );
        if (ul.level.audienceTags.length) {
          await this.maybeRemoveTags(
            ul.userId,
            ul.levelId,
            ul.user.email,
            ul.level.audienceTags,
            ul.level.audienceId ?? undefined,
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        `[paypal-sweep] failed: ${err instanceof Error ? err.message : err}`,
      );
    } finally {
      if (!userId) this.sweeping = false;
    }
  }
}
