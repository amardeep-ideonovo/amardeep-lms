import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { MailchimpProducer } from '../mailchimp/mailchimp.producer';
import {
  NotificationsService,
  type RecordNotificationInput,
} from '../notifications/notifications.service';

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

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  // Installments→lifetime conversion + global pause=no-access live in the
  // webhook reconcile + fulfillInstallmentsIfComplete below.

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly mailchimp: MailchimpProducer,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  // Where Stripe redirects users back to (the MEMBER WEB app, not the API).
  private appUrl(): string {
    return this.config.get<string>('WEB_APP_URL') || 'http://localhost:3002';
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
    // unknown, or foreign Stripe price ids with a clean 404 (instead of
    // forwarding them to Stripe and surfacing a raw "No such price" failure),
    // and gives us the target Level for the duplicate-subscription guard below.
    const price = await this.prisma.price.findUnique({
      where: { stripePriceId: priceId },
      include: { level: true },
    });
    if (!price || !price.active) {
      throw new NotFoundException('This plan is not available');
    }

    // Prevent a second concurrent subscription to a level the member already
    // pays for — Stripe would happily create one, double-charging them. To
    // change or cancel an existing paid plan they use the customer portal.
    const existingPaid = await this.prisma.userLevel.findFirst({
      where: {
        userId: user.id,
        levelId: price.levelId,
        source: 'STRIPE',
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
      priceId,
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
        source: 'STRIPE',
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

  // Public config for the checkout page. `publishableKey` is null when Stripe
  // isn't configured — the web app then runs its mock payment path.
  async getConfig(): Promise<BillingConfigDTO> {
    return { publishableKey: await this.stripe.getElementsPublishableKey() };
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

    const price = await this.prisma.price.findUnique({
      where: { stripePriceId: input.priceId },
      include: { level: true },
    });
    if (!price || !price.active) {
      throw new NotFoundException('This plan is not available');
    }

    const existingPaid = await this.prisma.userLevel.findFirst({
      where: {
        userId: user.id,
        levelId: price.levelId,
        source: 'STRIPE',
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
      ).map((p) => p.stripePriceId),
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
        s.items.data.some((it) => priceOf(it) === input.priceId),
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
      priceId: input.priceId,
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

    const price = await this.prisma.price.findUnique({
      where: { stripePriceId: input.priceId },
      include: { level: true },
    });
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
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    return this.detailsForCustomer(user?.stripeCustomerId ?? null);
  }

  async getMyInvoices(userId: string): Promise<InvoiceDTO[]> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    return this.invoicesForCustomer(user?.stripeCustomerId ?? null);
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
    const [subscriptions, invoices, lifetimeRows] = await Promise.all([
      this.detailsForCustomer(user.stripeCustomerId),
      this.invoicesForCustomer(user.stripeCustomerId),
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
      subscriptions,
      invoices,
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

  // Pause ONE subscription: stop billing (pause_collection) AND suspend access.
  // Reconciling inline flips the grant to PAUSED immediately (no webhook needed).
  async pauseSub(memberId: string, subId: string): Promise<MemberBillingDTO> {
    await this.memberSub(memberId, subId);
    const sub = await this.stripe.pauseSubscription(subId);
    await this.reconcileSubscription(sub, `admin:pause:${subId}`);
    return this.getMemberBilling(memberId);
  }

  // Resume a PAUSED subscription: clear the pause and restore access. Never
  // un-cancels (resumeSubscription only clears pause_collection).
  async resumeSub(memberId: string, subId: string): Promise<MemberBillingDTO> {
    await this.memberSub(memberId, subId);
    const sub = await this.stripe.resumeSubscription(subId);
    await this.reconcileSubscription(sub, `admin:resume:${subId}`);
    return this.getMemberBilling(memberId);
  }

  // Cancel ONE subscription. `immediate` ends billing AND access now;
  // `period_end` stops the renewal but keeps access until the paid period ends
  // (Stripe auto-cancels then). Cancellation is final — there is no resume.
  async cancelSub(
    memberId: string,
    subId: string,
    mode: 'immediate' | 'period_end',
  ): Promise<MemberBillingDTO> {
    await this.memberSub(memberId, subId);
    const sub =
      mode === 'immediate'
        ? await this.stripe.cancelSubscription(subId)
        : await this.stripe.setCancelAtPeriodEnd(subId, true);
    await this.reconcileSubscription(sub, `admin:cancel:${mode}:${subId}`);
    return this.getMemberBilling(memberId);
  }

  // Member self-service cancellation: ALWAYS at period end — the member keeps the
  // access they've already paid for and billing simply won't renew. (Immediate
  // cancel stays an admin-only action.) memberSub enforces that the subscription
  // belongs to this member.
  async cancelMyMembership(
    userId: string,
    subId: string,
  ): Promise<SubscriptionDetailDTO[]> {
    await this.memberSub(userId, subId);
    const sub = await this.stripe.setCancelAtPeriodEnd(subId, true);
    await this.reconcileSubscription(sub, `member:cancel:${subId}`);
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
   * - Upsert SubscriptionMirror.
   * - For each subscription item, map its price -> Level (via Price table) and
   *   upsert a UserLevel(source=STRIPE) with the mapped status.
   * - Any STRIPE-sourced UserLevel for this user that is NOT in the current
   *   item set is marked CANCELED (e.g. an item was removed).
   * - Enqueue Mailchimp tag add/remove per level transition.
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
    const subStatusFinal = paused ? ('PAUSED' as const) : subStatus;
    const levelStatusFinal = paused ? ('PAUSED' as const) : levelStatus;
    const periodEnd = sub.current_period_end
      ? new Date(sub.current_period_end * 1000)
      : null;

    // Capture the prior mirror BEFORE the upsert so lifecycle notifications fire
    // only on a genuine transition (this also makes webhook replays no-ops).
    const prevMirror = await this.prisma.subscriptionMirror.findUnique({
      where: { stripeSubId: sub.id },
    });

    await this.prisma.subscriptionMirror.upsert({
      where: { stripeSubId: sub.id },
      create: {
        stripeSubId: sub.id,
        stripeCustomerId: customerId,
        status: subStatusFinal,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
      },
      update: {
        status: subStatusFinal,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
      },
    });

    // Map each subscription item's price -> our Level.
    const items = sub.items?.data ?? [];
    // Item ids on THIS subscription — used to scope cancellation so we never
    // touch grants that belong to the customer's OTHER subscriptions.
    const thisSubItemIds = new Set(items.map((i) => i.id));
    const desired = new Map<
      string,
      {
        levelId: string;
        subItemId: string;
        mailchimpTags: string[];
        mailchimpAudienceId: string | null;
      }
    >();
    // Human-readable level names for this subscription, for notification bodies.
    const levelNames: string[] = [];
    for (const item of items) {
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
      desired.set(price.levelId, {
        levelId: price.levelId,
        subItemId: item.id,
        mailchimpTags: price.level.mailchimpTags,
        mailchimpAudienceId: price.level.mailchimpAudienceId,
      });
      levelNames.push(price.level.name);
    }

    // Existing STRIPE-sourced grants for this user.
    const existing = await this.prisma.userLevel.findMany({
      where: { userId: user.id, source: 'STRIPE' },
      include: { level: true },
    });
    const existingByLevel = new Map(existing.map((ul) => [ul.levelId, ul]));

    // Upsert desired levels.
    for (const [levelId, info] of desired) {
      const prev = existingByLevel.get(levelId);
      // Never downgrade a lifetime grant (a paid-in-full installment plan stays
      // ACTIVE forever, even as its now-cancelled subscription reconciles).
      const statusForRow = prev?.lifetime ? 'ACTIVE' : levelStatusFinal;
      await this.prisma.userLevel.upsert({
        where: {
          userId_levelId_source: {
            userId: user.id,
            levelId,
            source: 'STRIPE',
          },
        },
        create: {
          userId: user.id,
          levelId,
          source: 'STRIPE',
          status: statusForRow,
          stripeSubItemId: info.subItemId,
          expiresAt: periodEnd,
        },
        update: {
          status: statusForRow,
          stripeSubItemId: info.subItemId,
          expiresAt: prev?.lifetime ? null : periodEnd,
        },
      });

      // Audience/tag sync: add when newly active, remove when transitioning to
      // non-active — but NOT for a mere pause (keep tags during a pause so a
      // temporary suspension doesn't churn Mailchimp).
      if (info.mailchimpTags.length || info.mailchimpAudienceId) {
        const wasActive = prev?.status === 'ACTIVE';
        const nowActive = statusForRow === 'ACTIVE';
        if (nowActive && !wasActive) {
          await this.mailchimp.enqueueTags(
            'add',
            user.email,
            info.mailchimpTags,
            info.mailchimpAudienceId ?? undefined,
          );
        } else if (!nowActive && wasActive && statusForRow !== 'PAUSED') {
          await this.maybeRemoveTags(
            user.id,
            levelId,
            user.email,
            info.mailchimpTags,
            info.mailchimpAudienceId ?? undefined,
          );
        }
      }
    }

    // Items removed FROM THIS subscription -> CANCELED, EXCEPT lifetime grants
    // (a completed installment plan), which are permanent. We only revoke grants
    // tied to THIS subscription's items: each class is its own Stripe
    // subscription, so a grant from a DIFFERENT subscription must not be
    // cancelled here. (Previously this loop cancelled every STRIPE grant not on
    // the current subscription, so reconciling one class revoked the member's
    // other classes.)
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
      if (ul.level.mailchimpTags.length && ul.status === 'ACTIVE') {
        await this.maybeRemoveTags(
          user.id,
          ul.levelId,
          user.email,
          ul.level.mailchimpTags,
          ul.level.mailchimpAudienceId ?? undefined,
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
    const newCancelAtPe = sub.cancel_at_period_end ?? false;
    const periodKey = sub.current_period_end ?? 'na';

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
        dedupeKey: `sub:created:${sub.id}`,
      });
    }
    if (prevStatus !== 'PAUSED' && subStatusFinal === 'PAUSED') {
      await this.notify({
        type: 'SUBSCRIPTION_PAUSED',
        severity: 'WARNING',
        title: 'Subscription paused',
        body: `${user.email} — ${planLabel} is on hold`,
        userId: user.id,
        dedupeKey: `sub:paused:${sub.id}:${sourceEventId ?? periodKey}`,
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
        dedupeKey: `sub:resumed:${sub.id}:${sourceEventId ?? periodKey}`,
      });
    }
    if (prevStatus !== 'CANCELED' && subStatusFinal === 'CANCELED') {
      await this.notify({
        type: 'SUBSCRIPTION_CANCELED',
        severity: 'CRITICAL',
        title: 'Subscription canceled',
        body: `${user.email} — ${planLabel} canceled`,
        userId: user.id,
        dedupeKey: `sub:canceled:${sub.id}`,
      });
    }
    if (!prevCancelAtPe && newCancelAtPe && subStatusFinal !== 'CANCELED') {
      await this.notify({
        type: 'SUBSCRIPTION_CANCEL_SCHEDULED',
        severity: 'WARNING',
        title: 'Cancellation scheduled',
        body: `${user.email} — ${planLabel} will cancel at the period end`,
        userId: user.id,
        dedupeKey: `sub:cancel_scheduled:${sub.id}`,
      });
    }
  }

  // Only enqueue a tag removal if the user has no OTHER active grant for the
  // level (e.g. a manual grant), keeping Mailchimp state consistent.
  private async maybeRemoveTags(
    userId: string,
    levelId: string,
    email: string,
    tags: string[],
    audienceId?: string,
  ): Promise<void> {
    const stillActive = await this.prisma.userLevel.count({
      where: { userId, levelId, status: 'ACTIVE' },
    });
    if (stillActive === 0) {
      await this.mailchimp.enqueueTags('remove', email, tags, audienceId);
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

}
