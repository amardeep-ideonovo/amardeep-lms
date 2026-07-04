import { Injectable, Logger } from '@nestjs/common';
import type Stripe from 'stripe';
import type { SubscriptionRowDTO } from '@lms/types';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../billing/stripe.service';
import {
  PayPalService,
  type PayPalSubscription,
} from '../billing/paypal.service';

// Admin "Subscriptions" tab. Every subscription (active + historical, both
// providers), enriched with the local member (name/email) and level
// (name/price), plus an order count + last-order date.
//
// Stripe rows are sourced LIVE (all subscriptions + all invoices listed once,
// auto-paged, hard capped; members/levels resolved in two bulk Prisma
// queries). PayPal has no merchant-wide list API, so its rows come from the
// local SubscriptionMirror (the index) enriched with per-sub live lookups.
@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly paypal: PayPalService,
  ) {}

  async list(): Promise<SubscriptionRowDTO[]> {
    const [stripeRows, paypalRows] = await Promise.all([
      this.stripeRows(),
      this.paypalRows(),
    ]);
    const rows = [...stripeRows, ...paypalRows];
    // Newest subscriptions first (matches the WooCommerce default ordering).
    rows.sort((a, b) => {
      const ta = a.startDate ? Date.parse(a.startDate) : 0;
      const tb = b.startDate ? Date.parse(b.startDate) : 0;
      return tb - ta;
    });
    return rows;
  }

  private async stripeRows(): Promise<SubscriptionRowDTO[]> {
    // A PayPal-only site has no Stripe key — that's an empty list, not an error.
    if (!(await this.stripe.isConfigured())) return [];
    const [subs, invoices] = await Promise.all([
      this.stripe.listAllSubscriptions(),
      this.stripe.listAllInvoices(),
    ]);

    // Per-subscription order rollup: count + most-recent invoice date. Drafts
    // aren't placed "orders" yet, so they're excluded.
    const agg = new Map<string, { orders: number; lastOrder: number }>();
    for (const inv of invoices) {
      const subId =
        typeof inv.subscription === 'string'
          ? inv.subscription
          : inv.subscription?.id;
      if (!subId || inv.status === 'draft') continue;
      const cur = agg.get(subId) ?? { orders: 0, lastOrder: 0 };
      cur.orders += 1;
      if (inv.created > cur.lastOrder) cur.lastOrder = inv.created;
      agg.set(subId, cur);
    }

    // Bulk-resolve members (by Stripe customer) and levels (by Stripe price).
    const customerIds = Array.from(
      new Set(
        subs
          .map((s) =>
            typeof s.customer === 'string' ? s.customer : s.customer?.id,
          )
          .filter((v): v is string => !!v),
      ),
    );
    const priceIds = Array.from(
      new Set(
        subs.flatMap((s) =>
          (s.items?.data ?? [])
            .map((it) => (typeof it.price === 'string' ? it.price : it.price?.id))
            .filter((v): v is string => !!v),
        ),
      ),
    );

    // `in: []` is valid (returns no rows), so we always issue both queries —
    // simpler than conditional fallbacks and keeps Prisma's inferred types.
    const [users, prices] = await Promise.all([
      this.prisma.user.findMany({
        where: { stripeCustomerId: { in: customerIds } },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          stripeCustomerId: true,
        },
      }),
      this.prisma.price.findMany({
        where: { stripePriceId: { in: priceIds } },
        include: { level: true },
      }),
    ]);

    const userByCustomer = new Map(
      users
        .filter((u) => u.stripeCustomerId)
        .map((u) => [u.stripeCustomerId as string, u]),
    );
    const priceByStripeId = new Map(prices.map((p) => [p.stripePriceId, p]));

    const iso = (unix?: number | null): string | null =>
      unix ? new Date(unix * 1000).toISOString() : null;

    const rows: SubscriptionRowDTO[] = subs.map((sub) => {
      // --- Name (local member, falling back to the expanded Stripe customer) ---
      const customerId =
        typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null;
      const localUser = customerId ? userByCustomer.get(customerId) : undefined;
      let memberId: string | null = null;
      let memberName = 'Unknown';
      let memberEmail: string | null = null;
      if (localUser) {
        memberId = localUser.id;
        memberEmail = localUser.email;
        memberName =
          [localUser.firstName, localUser.lastName]
            .filter(Boolean)
            .join(' ')
            .trim() || localUser.email;
      } else if (
        sub.customer &&
        typeof sub.customer !== 'string' &&
        !('deleted' in sub.customer)
      ) {
        const c = sub.customer as Stripe.Customer;
        memberEmail = c.email ?? null;
        memberName = c.name || c.email || 'Unknown';
      }

      // --- Level Name + Total (prefer our local Price for the real terms) ---
      const levelNames: string[] = [];
      let levelId: string | null = null;
      let amount: number | null = null;
      let interval: string | null = null;
      let currency = sub.currency ?? 'usd';
      let installmentsTotal: number | null = null;
      for (const item of sub.items?.data ?? []) {
        const stripePriceId =
          typeof item.price === 'string' ? item.price : item.price?.id;
        const local = stripePriceId
          ? priceByStripeId.get(stripePriceId)
          : undefined;
        if (local) {
          levelNames.push(local.level.name);
          if (amount == null) {
            amount = local.amount;
            interval = local.interval;
            currency = local.currency;
            levelId = local.level.id;
            installmentsTotal = local.installments;
          }
        } else if (item.price && typeof item.price !== 'string') {
          // Foreign/unmapped price — fall back to Stripe's own figures.
          levelNames.push(item.price.nickname || 'Plan');
          if (amount == null) {
            amount = item.price.unit_amount ?? null;
            interval = item.price.recurring?.interval ?? null;
            currency = item.price.currency ?? currency;
          }
        }
      }
      const levelName = levelNames.join(', ') || '—';

      // --- Status + dates ---
      const paused = sub.pause_collection != null;
      const cancelAtPeriodEnd = sub.cancel_at_period_end ?? false;
      const billing = ['active', 'trialing', 'past_due'].includes(sub.status);
      const nextPayment =
        billing && !paused && !cancelAtPeriodEnd
          ? iso(sub.current_period_end)
          : null;
      const endDate =
        iso(sub.ended_at) ??
        iso(sub.cancel_at) ??
        (cancelAtPeriodEnd ? iso(sub.current_period_end) : null);

      const a = agg.get(sub.id);

      return {
        id: sub.id,
        provider: 'stripe' as const,
        memberId,
        memberName,
        memberEmail,
        levelId,
        levelName,
        status: sub.status,
        paused,
        cancelAtPeriodEnd,
        amount,
        currency: (currency ?? 'usd').toLowerCase(),
        interval,
        startDate: iso(sub.start_date),
        nextPayment,
        lastOrderDate: a?.lastOrder ? iso(a.lastOrder) : null,
        endDate,
        orders: a?.orders ?? 0,
        installmentsTotal,
      };
    });

    return rows;
  }

  // PayPal rows from the mirror index + live per-sub lookups (capped). A
  // PayPal outage degrades to mirror-only rows rather than failing the tab.
  private async paypalRows(): Promise<SubscriptionRowDTO[]> {
    const mirrors = await this.prisma.subscriptionMirror.findMany({
      where: { provider: 'PAYPAL' },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    if (mirrors.length === 0) return [];

    const userIds = Array.from(
      new Set(mirrors.map((m) => m.userId).filter((v): v is string => !!v)),
    );
    const priceIds = Array.from(
      new Set(mirrors.map((m) => m.priceId).filter((v): v is string => !!v)),
    );
    const [users, prices] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true, firstName: true, lastName: true },
      }),
      this.prisma.price.findMany({
        where: { id: { in: priceIds } },
        include: { level: true },
      }),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const priceById = new Map(prices.map((p) => [p.id, p]));

    const live = new Map<string, PayPalSubscription>();
    const results = await Promise.allSettled(
      mirrors.map((m) => this.paypal.getSubscription(m.stripeSubId)),
    );
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') live.set(mirrors[i].stripeSubId, r.value);
    });

    return mirrors.map((m) => {
      const sub = live.get(m.stripeSubId) ?? null;
      const user = m.userId ? userById.get(m.userId) : undefined;
      const price = m.priceId ? priceById.get(m.priceId) : undefined;
      const paused = sub
        ? sub.status === 'SUSPENDED'
        : m.status === 'PAUSED';
      const status = sub
        ? sub.status === 'SUSPENDED'
          ? 'paused'
          : sub.status === 'CANCELLED' || sub.status === 'EXPIRED'
            ? 'canceled'
            : sub.status === 'ACTIVE'
              ? 'active'
              : 'incomplete'
        : m.status.toLowerCase();
      const regular = sub?.billing_info?.cycle_executions?.find(
        (c) => c.tenure_type === 'REGULAR',
      );
      const nextPayment =
        status === 'active' && !m.cancelAtPeriodEnd
          ? (sub?.billing_info?.next_billing_time ??
            m.currentPeriodEnd?.toISOString() ??
            null)
          : null;
      return {
        id: m.stripeSubId,
        provider: 'paypal' as const,
        memberId: user?.id ?? null,
        memberName: user
          ? [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
            user.email
          : 'Unknown',
        memberEmail: user?.email ?? null,
        levelId: price?.level.id ?? null,
        levelName: price?.level.name ?? '—',
        status,
        paused,
        cancelAtPeriodEnd: m.cancelAtPeriodEnd,
        amount: price?.amount ?? null,
        currency: (price?.currency ?? 'usd').toLowerCase(),
        interval: price?.interval ?? null,
        startDate: sub?.start_time ?? null,
        nextPayment,
        lastOrderDate: sub?.billing_info?.last_payment?.time ?? null,
        endDate:
          status === 'canceled'
            ? (sub?.status_update_time ?? m.updatedAt.toISOString())
            : null,
        orders: regular?.cycles_completed ?? 0,
        installmentsTotal: price?.installments ?? null,
      };
    });
  }
}
