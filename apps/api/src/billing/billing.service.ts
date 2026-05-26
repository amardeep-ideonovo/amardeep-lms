import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Stripe from 'stripe';
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
      successUrl: `${this.appUrl()}/account?checkout=success`,
      cancelUrl: `${this.appUrl()}/account?checkout=cancel`,
    });
    if (!session.url) {
      throw new BadRequestException('Stripe did not return a checkout URL');
    }
    return { url: session.url };
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
      this.logger.warn(`Webhook signature verification failed: ${err}`);
      throw new BadRequestException('Invalid signature');
    }

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
        this.logger.debug(`Unhandled Stripe event: ${event.type}`);
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
