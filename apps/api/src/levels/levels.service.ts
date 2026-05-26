import { Injectable, NotFoundException } from '@nestjs/common';
import type { LevelDTO } from '@lms/types';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../billing/stripe.service';
import { CreateLevelDto, UpdateLevelDto } from './dto/level.dto';

type LevelWithPrices = {
  id: string;
  name: string;
  type: any;
  mailchimpTag: string | null;
  mailchimpAudienceId: string | null;
  mailchimpAudienceName: string | null;
  stripeProductId: string | null;
  prices: {
    id: string;
    stripePriceId: string;
    interval: string;
    amount: number;
    currency: string;
  }[];
};

@Injectable()
export class LevelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
  ) {}

  private toDTO(level: LevelWithPrices, memberCount = 0): LevelDTO {
    return {
      id: level.id,
      name: level.name,
      type: level.type,
      mailchimpTag: level.mailchimpTag,
      mailchimpAudienceId: level.mailchimpAudienceId,
      mailchimpAudienceName: level.mailchimpAudienceName,
      stripeProductId: level.stripeProductId,
      prices: level.prices.map((p) => ({
        id: p.id,
        stripePriceId: p.stripePriceId,
        interval: p.interval as 'month' | 'year',
        amount: p.amount,
        currency: p.currency,
      })),
      memberCount,
    };
  }

  // Distinct members holding an ACTIVE grant for each level. A user can hold the
  // same level via two sources (STRIPE + MANUAL), so we dedupe on userId rather
  // than counting UserLevel rows.
  private async activeMemberCounts(): Promise<Map<string, number>> {
    const rows = await this.prisma.userLevel.findMany({
      where: { status: 'ACTIVE' },
      select: { userId: true, levelId: true },
    });
    const byLevel = new Map<string, Set<string>>();
    for (const r of rows) {
      const set = byLevel.get(r.levelId) ?? new Set<string>();
      set.add(r.userId);
      byLevel.set(r.levelId, set);
    }
    return new Map([...byLevel].map(([levelId, users]) => [levelId, users.size]));
  }

  // includeCounts is set only for admin requests (member-facing calls get 0).
  async list(includeCounts = false): Promise<LevelDTO[]> {
    const levels = await this.prisma.level.findMany({
      include: { prices: true },
      orderBy: { createdAt: 'asc' },
    });
    const counts = includeCounts
      ? await this.activeMemberCounts()
      : new Map<string, number>();
    return levels.map((l) =>
      this.toDTO(l as LevelWithPrices, counts.get(l.id) ?? 0),
    );
  }

  async create(dto: CreateLevelDto): Promise<LevelDTO> {
    let stripeProductId: string | null = null;
    const priceRows: {
      stripePriceId: string;
      interval: string;
      amount: number;
      currency: string;
    }[] = [];

    // PAID levels get a Stripe Product + a Price per requested interval.
    if (dto.type === 'PAID' && dto.prices?.length) {
      const product = await this.stripe.createProduct(dto.name);
      stripeProductId = product.id;
      for (const price of dto.prices) {
        const currency = price.currency ?? 'usd';
        const stripePrice = await this.stripe.createPrice({
          productId: product.id,
          interval: price.interval,
          amount: price.amount,
          currency,
        });
        priceRows.push({
          stripePriceId: stripePrice.id,
          interval: price.interval,
          amount: price.amount,
          currency,
        });
      }
    }

    const level = await this.prisma.level.create({
      data: {
        name: dto.name,
        type: dto.type,
        mailchimpTag: dto.mailchimpTag ?? null,
        mailchimpAudienceId: dto.mailchimpAudienceId ?? null,
        mailchimpAudienceName: dto.mailchimpAudienceName ?? null,
        stripeProductId,
        prices: { create: priceRows },
      },
      include: { prices: true },
    });
    return this.toDTO(level as LevelWithPrices);
  }

  async update(id: string, dto: UpdateLevelDto): Promise<LevelDTO> {
    const existing = await this.prisma.level.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Level not found');
    const level = await this.prisma.level.update({
      where: { id },
      data: {
        name: dto.name ?? undefined,
        type: dto.type ?? undefined,
        mailchimpTag: dto.mailchimpTag ?? undefined,
        // The admin form always submits the full audience selection, so map
        // undefined/empty -> null (clears) and a value -> set.
        mailchimpAudienceId: dto.mailchimpAudienceId ?? null,
        mailchimpAudienceName: dto.mailchimpAudienceName ?? null,
      },
      include: { prices: true },
    });
    return this.toDTO(level as LevelWithPrices);
  }

  async remove(id: string): Promise<{ ok: true }> {
    const existing = await this.prisma.level.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Level not found');
    await this.prisma.level.delete({ where: { id } });
    return { ok: true };
  }
}
