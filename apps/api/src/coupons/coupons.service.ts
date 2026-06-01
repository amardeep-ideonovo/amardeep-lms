import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type Stripe from 'stripe';
import type { CouponDTO } from '@lms/types';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../billing/stripe.service';
import { CreateCouponDto } from './dto/coupon.dto';

// Coupons live in Stripe (no local mirror): create = Coupon + Promotion Code;
// list/deactivate read/toggle the promotion codes. Redemption counts + status
// come straight from Stripe, so there's nothing to keep in sync.
@Injectable()
export class CouponsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
  ) {}

  async list(): Promise<CouponDTO[]> {
    const codes = await this.stripe.listPromotionCodes();
    // Hide soft-deleted codes (see delete()) — promotion codes are permanent in
    // Stripe, so a deleted one lingers in the list with a metadata flag.
    return codes
      .filter((pc) => pc.metadata?.deleted !== 'true')
      .map((pc) => this.toDTO(pc));
  }

  async create(dto: CreateCouponDto): Promise<CouponDTO> {
    if (dto.discountType === 'percent' && dto.percentOff == null) {
      throw new BadRequestException('percentOff is required for a percent coupon');
    }
    if (dto.discountType === 'amount' && dto.amountOff == null) {
      throw new BadRequestException('amountOff is required for an amount coupon');
    }
    if (dto.duration === 'repeating' && dto.durationInMonths == null) {
      throw new BadRequestException(
        'durationInMonths is required for a repeating coupon',
      );
    }

    // Optional per-level restriction. We carry it in promotion-code metadata
    // and enforce it ourselves in validateCoupon/subscribe (our checkout is the
    // only path), since Stripe's coupon applies_to is unreliable on this account.
    // appliesToProducts is still set on the coupon as a belt-and-suspenders.
    let appliesToProducts: string[] | undefined;
    let levelMeta: Record<string, string> | undefined;
    if (dto.levelId) {
      const level = await this.prisma.level.findUnique({
        where: { id: dto.levelId },
        select: { id: true, name: true, stripeProductId: true },
      });
      if (!level) throw new NotFoundException('Level not found');
      if (!level.stripeProductId) {
        throw new BadRequestException(
          'That level has no paid plan yet, so it can’t back a coupon',
        );
      }
      appliesToProducts = [level.stripeProductId];
      levelMeta = {
        levelId: level.id,
        levelProductId: level.stripeProductId,
        levelName: level.name,
      };
    }

    const expiresAt = dto.expiresAt
      ? Math.floor(new Date(dto.expiresAt).getTime() / 1000)
      : undefined;

    const coupon = await this.stripe.createCoupon({
      percentOff: dto.discountType === 'percent' ? dto.percentOff : undefined,
      amountOff: dto.discountType === 'amount' ? dto.amountOff : undefined,
      currency: dto.currency,
      duration: dto.duration,
      durationInMonths: dto.durationInMonths,
      maxRedemptions: dto.maxRedemptions,
      redeemBy: expiresAt,
      name: dto.code,
      appliesToProducts,
    });

    let promo: Stripe.PromotionCode;
    try {
      promo = await this.stripe.createPromotionCode({
        couponId: coupon.id,
        code: dto.code,
        maxRedemptions: dto.maxRedemptions,
        expiresAt,
        metadata: levelMeta,
      });
    } catch (err) {
      // The coupon is created first; if the code is taken, roll it back so we
      // don't leak an orphaned coupon, then surface a clean error.
      await this.stripe.deleteCoupon(coupon.id).catch(() => undefined);
      const msg = (err as { message?: string })?.message ?? '';
      if (/already exists/i.test(msg)) {
        throw new ConflictException('That code is already in use');
      }
      throw err;
    }

    return this.toDTO(promo);
  }

  async setActive(id: string, active: boolean): Promise<CouponDTO> {
    const promo = await this.stripe.setPromotionCodeActive(id, active);
    return this.toDTO(promo);
  }

  // Permanently delete a coupon. Stripe promotion codes can't be deleted, so we
  // (1) hard-delete the backing Coupon — the code can never be redeemed again —
  // and (2) flag the promotion code via metadata + deactivate it, so list()
  // hides it and the row disappears from the admin UI.
  async delete(id: string): Promise<{ ok: true }> {
    const promo = await this.stripe.retrievePromotionCode(id);
    const couponId =
      typeof promo.coupon === 'string' ? promo.coupon : promo.coupon?.id;
    if (couponId) {
      try {
        await this.stripe.deleteCoupon(couponId);
      } catch {
        /* coupon already gone — fine */
      }
    }
    await this.stripe.updatePromotionCode(id, {
      active: false,
      metadata: { deleted: 'true' },
    });
    return { ok: true };
  }

  private toDTO(pc: Stripe.PromotionCode): CouponDTO {
    const coupon = pc.coupon;
    const meta = pc.metadata ?? {};
    return {
      id: pc.id,
      code: pc.code,
      active: pc.active,
      discountType: coupon.percent_off != null ? 'percent' : 'amount',
      percentOff: coupon.percent_off ?? null,
      amountOff: coupon.amount_off ?? null,
      currency: coupon.currency ?? null,
      duration: coupon.duration as 'once' | 'repeating' | 'forever',
      durationInMonths: coupon.duration_in_months ?? null,
      maxRedemptions: pc.max_redemptions ?? coupon.max_redemptions ?? null,
      timesRedeemed: pc.times_redeemed,
      expiresAt: pc.expires_at
        ? new Date(pc.expires_at * 1000).toISOString()
        : null,
      levelId: meta.levelId ?? null,
      levelName: meta.levelName ?? null,
      createdAt: new Date(pc.created * 1000).toISOString(),
    };
  }
}
