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

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly mailchimp: MailchimpProducer,
    private readonly config: ConfigService,
  ) {}

  // Where Stripe redirects users back to (the MEMBER WEB app, not the API).
  private appUrl(): string {
    return this.config.get<string>('WEB_APP_URL') || 'http://localhost:3002';
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
        'You already have an active subscription to this plan. Manage it from your account.',
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
        'You already have an active subscription to this plan. Manage it from your account.',
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
    const [subscriptions, invoices] = await Promise.all([
      this.detailsForCustomer(user.stripeCustomerId),
      this.invoicesForCustomer(user.stripeCustomerId),
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
    };
  }

  // The member's current live Stripe subscription (for an admin action).
  private async memberLiveSubId(memberId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { id: memberId } });
    if (!user?.stripeCustomerId) {
      throw new BadRequestException('Member has no Stripe customer');
    }
    const subs = await this.stripe.listSubscriptionsForCustomer(
      user.stripeCustomerId,
    );
    const live = subs.find((s) =>
      ['active', 'past_due', 'trialing', 'paused', 'unpaid'].includes(s.status),
    );
    if (!live) {
      throw new BadRequestException('No active subscription for this member');
    }
    return live.id;
  }

  async pauseMember(memberId: string): Promise<MemberBillingDTO> {
    await this.stripe.pauseSubscription(await this.memberLiveSubId(memberId));
    return this.getMemberBilling(memberId);
  }

  async resumeMember(memberId: string): Promise<MemberBillingDTO> {
    const sub = await this.stripe.resumeSubscription(
      await this.memberLiveSubId(memberId),
    );
    await this.reconcileSubscription(sub); // reflect the resumed grant locally
    return this.getMemberBilling(memberId);
  }

  async cancelMember(memberId: string): Promise<MemberBillingDTO> {
    await this.stripe.setCancelAtPeriodEnd(
      await this.memberLiveSubId(memberId),
      true,
    );
    return this.getMemberBilling(memberId);
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
            await this.reconcileSubscription(sub);
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
  private async reconcileSubscription(sub: Stripe.Subscription): Promise<void> {
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
    const periodEnd = sub.current_period_end
      ? new Date(sub.current_period_end * 1000)
      : null;

    await this.prisma.subscriptionMirror.upsert({
      where: { stripeSubId: sub.id },
      create: {
        stripeSubId: sub.id,
        stripeCustomerId: customerId,
        status: subStatus,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
      },
      update: {
        status: subStatus,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
      },
    });

    // Map each subscription item's price -> our Level.
    const items = sub.items?.data ?? [];
    const desired = new Map<
      string,
      {
        levelId: string;
        subItemId: string;
        mailchimpTags: string[];
        mailchimpAudienceId: string | null;
      }
    >();
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
          status: levelStatus,
          stripeSubItemId: info.subItemId,
          expiresAt: periodEnd,
        },
        update: {
          status: levelStatus,
          stripeSubItemId: info.subItemId,
          expiresAt: periodEnd,
        },
      });

      // Audience/tag sync: add when newly active, remove when transitioning to
      // non-active. Subscribes to the level's own audience (or the global one).
      if (info.mailchimpTags.length || info.mailchimpAudienceId) {
        const wasActive = prev?.status === 'ACTIVE';
        const nowActive = levelStatus === 'ACTIVE';
        if (nowActive && !wasActive) {
          await this.mailchimp.enqueueTags(
            'add',
            user.email,
            info.mailchimpTags,
            info.mailchimpAudienceId ?? undefined,
          );
        } else if (!nowActive && wasActive) {
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

    // Levels no longer present on the subscription -> CANCELED.
    for (const ul of existing) {
      if (!desired.has(ul.levelId)) {
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
}
