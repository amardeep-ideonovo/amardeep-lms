import { Injectable, Logger } from '@nestjs/common';
import type Stripe from 'stripe';
import type { SubscriptionRowDTO } from '@lms/types';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../billing/stripe.service';

// Admin "Subscriptions" tab. Every Stripe subscription (active + historical),
// enriched with the local member (name/email) and level (name/price), plus an
// order count + last-order date derived from the account's invoices.
//
// Sourced LIVE from Stripe because the local SubscriptionMirror is intentionally
// thin (status + period end only — see schema.prisma). To stay O(1) in Stripe
// round-trips we list all subscriptions and all invoices ONCE (auto-paged, hard
// capped) and resolve members/levels in two bulk Prisma queries — no per-row
// API or DB hits.
@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
  ) {}

  async list(): Promise<SubscriptionRowDTO[]> {
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

    // Newest subscriptions first (matches the WooCommerce default ordering).
    rows.sort((a, b) => {
      const ta = a.startDate ? Date.parse(a.startDate) : 0;
      const tb = b.startDate ? Date.parse(b.startDate) : 0;
      return tb - ta;
    });
    return rows;
  }
}
