import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  CheckoutLevelDTO,
  ClassPublicDTO,
  ClassTileDTO,
  CourseCard,
  LevelCategoryDTO,
  LevelDTO,
  MyClassCoursesDTO,
  PublicClassListItem,
  SkillDTO,
} from '@lms/types';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from '../lms/access.service';
import { CertificatesService } from '../certificates/certificates.service';
import { StripeService } from '../billing/stripe.service';
import { PayPalService } from '../billing/paypal.service';
import { MailchimpProducer } from '../mailchimp/mailchimp.producer';
import {
  CreateLevelCategoryDto,
  CreateLevelDto,
  UpdateLevelDto,
} from './dto/level.dto';

type LevelWithPrices = {
  id: string;
  name: string;
  slug: string | null;
  published: boolean;
  type: any;
  mailchimpTags: string[];
  mailchimpAudienceId: string | null;
  mailchimpAudienceName: string | null;
  stripeProductId: string | null;
  imageUrl: string | null;
  description: string | null;
  trailerUrl: string | null;
  featuredCourseId: string | null;
  certificateTemplateId: string | null;
  skills: unknown; // Json column — normalized via normalizeSkills()
  prices: {
    id: string;
    stripePriceId: string | null;
    paypalPlanId: string | null;
    interval: string;
    amount: number;
    currency: string;
    installments: number | null;
  }[];
  categories: { id: string; name: string; order: number }[];
};

@Injectable()
export class LevelsService {
  private readonly logger = new Logger(LevelsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly paypal: PayPalService,
    private readonly mailchimp: MailchimpProducer,
    private readonly access: AccessService,
    private readonly certificates: CertificatesService,
  ) {}

  private toDTO(level: LevelWithPrices, memberCount = 0): LevelDTO {
    return {
      id: level.id,
      name: level.name,
      slug: level.slug,
      published: level.published,
      type: level.type,
      mailchimpTags: level.mailchimpTags,
      mailchimpAudienceId: level.mailchimpAudienceId,
      mailchimpAudienceName: level.mailchimpAudienceName,
      stripeProductId: level.stripeProductId,
      imageUrl: level.imageUrl,
      description: level.description,
      trailerUrl: level.trailerUrl,
      featuredCourseId: level.featuredCourseId,
      certificateTemplateId: level.certificateTemplateId,
      skills: this.normalizeSkills(level.skills),
      prices: level.prices.map((p) => ({
        id: p.id,
        stripePriceId: p.stripePriceId,
        interval: p.interval as 'month' | 'year',
        amount: p.amount,
        currency: p.currency,
        installments: p.installments,
      })),
      categories: level.categories.map((c) => ({
        id: c.id,
        name: c.name,
        order: c.order,
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
      // Only active prices are offered; archived ones are kept for existing
      // subscribers but must never resurface on /pricing or the admin form.
      include: {
        prices: { where: { active: true } },
        categories: { orderBy: { order: 'asc' } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const counts = includeCounts
      ? await this.activeMemberCounts()
      : new Map<string, number>();
    return levels.map((l) =>
      this.toDTO(l as LevelWithPrices, counts.get(l.id) ?? 0),
    );
  }

  // Public: resolve a PAID level (by slug OR raw id) for the checkout page.
  // Returns only what checkout needs; 404 when missing or without active prices.
  async checkoutBySlugOrId(slugOrId: string): Promise<CheckoutLevelDTO> {
    const level = await this.prisma.level.findFirst({
      where: { type: 'PAID', OR: [{ slug: slugOrId }, { id: slugOrId }] },
      include: { prices: { where: { active: true } } },
    });
    if (!level || level.prices.length === 0) {
      throw new NotFoundException('Checkout not found');
    }
    return {
      id: level.id,
      name: level.name,
      slug: level.slug,
      prices: level.prices.map((p) => ({
        id: p.id,
        stripePriceId: p.stripePriceId,
        interval: p.interval as 'month' | 'year',
        amount: p.amount,
        currency: p.currency,
        installments: p.installments,
      })),
    };
  }

  // Public: full class landing-page data (MasterClass-style). Curriculum = the
  // featured course's lessons (titles/durations/thumbnails only — no playback
  // for logged-out visitors). 404 when the class doesn't exist.
  async classPageBySlugOrId(slugOrId: string): Promise<ClassPublicDTO> {
    const level = await this.prisma.level.findFirst({
      where: { OR: [{ slug: slugOrId }, { id: slugOrId }] },
      include: {
        prices: { where: { active: true } },
        categories: { orderBy: { order: 'asc' } },
        featuredCourse: {
          include: {
            lessons: {
              orderBy: { order: 'asc' },
              select: {
                title: true,
                durationSeconds: true,
                thumbnailUrl: true,
                order: true,
              },
            },
          },
        },
      },
    });
    if (!level) throw new NotFoundException('Class not found');
    const lessons = (level.featuredCourse?.lessons ?? []).map((l) => ({
      title: l.title,
      durationSeconds: l.durationSeconds,
      thumbnailUrl: l.thumbnailUrl,
      order: l.order,
    }));
    const totalDurationSeconds = lessons.reduce(
      (n, l) => n + (l.durationSeconds ?? 0),
      0,
    );
    return {
      id: level.id,
      name: level.name,
      slug: level.slug,
      imageUrl: level.imageUrl,
      description: level.description,
      trailerUrl: level.trailerUrl,
      categories: level.categories.map((c) => ({
        id: c.id,
        name: c.name,
        order: c.order,
      })),
      skills: this.normalizeSkills(level.skills),
      lessons,
      lessonCount: lessons.length,
      totalDurationSeconds,
      prices: level.prices.map((p) => ({
        id: p.id,
        stripePriceId: p.stripePriceId,
        interval: p.interval as 'month' | 'year',
        amount: p.amount,
        currency: p.currency,
        installments: p.installments,
      })),
    };
  }

  // Public: minimal class list for the sitemap + cross-linking.
  async listPublicClasses(): Promise<PublicClassListItem[]> {
    const levels = await this.prisma.level.findMany({
      where: { published: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, slug: true },
    });
    return levels.map((l) => ({ id: l.id, name: l.name, slug: l.slug }));
  }

  // Member dashboard tiles: every PUBLISHED class (so members can browse/buy)
  // PLUS any class the member is actively enrolled in (so an unpublished class
  // they own still appears, never stranding them). `owned` marks the active
  // ones. Tiles link to /classes/<slug ?? id>.
  async myClasses(userId: string): Promise<ClassTileDTO[]> {
    const owned = await this.access.activeLevelIds(userId);
    const levels = await this.prisma.level.findMany({
      where: {
        OR: [
          { published: true },
          { id: { in: [...owned] } }, // always surface classes the member owns
        ],
      },
      include: { categories: { orderBy: { order: 'asc' } } },
      orderBy: { name: 'asc' },
    });
    return levels.map((l) => ({
      id: l.id,
      name: l.name,
      slug: l.slug,
      imageUrl: l.imageUrl,
      owned: owned.has(l.id),
      categories: l.categories.map((c) => ({
        id: c.id,
        name: c.name,
        order: c.order,
      })),
    }));
  }

  // A class's courses for the class page — returned ONLY when the member owns the
  // class. Not owned (or logged-out) => owned:false + []. The course player is
  // independently access-gated, so this is a UX convenience, not the security
  // boundary. 404 only when the class itself doesn't exist.
  async myClassCourses(
    userId: string,
    slugOrId: string,
  ): Promise<MyClassCoursesDTO> {
    const level = await this.prisma.level.findFirst({
      where: { OR: [{ slug: slugOrId }, { id: slugOrId }] },
      select: { id: true, name: true, certificateTemplateId: true },
    });
    if (!level) throw new NotFoundException('Class not found');

    const owned = (await this.access.activeLevelIds(userId)).has(level.id);
    if (!owned) return { owned: false, courses: [] };

    const [courses, completedByCourse] = await Promise.all([
      this.prisma.course.findMany({
        where: { courseLevels: { some: { levelId: level.id } } },
        orderBy: { order: 'asc' },
        include: {
          courseLevels: { select: { levelId: true } },
          _count: { select: { lessons: true } },
        },
      }),
      this.access.completedCountByCourse(userId),
    ]);

    const courseCards: CourseCard[] = courses.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      thumbnailUrl: c.thumbnailUrl,
      coverImageUrl: c.coverImageUrl,
      levelIds: c.courseLevels.map((cl) => cl.levelId),
      locked: false, // owned => unlocked
      lessonCount: c._count.lessons,
      completedCount: completedByCourse.get(c.id) ?? 0,
    }));

    // Class-page certificate state (omitted while no template resolves). The
    // lesson totals are already in hand, so this only adds claim state.
    const totals = courseCards.reduce(
      (acc, c) => ({
        total: acc.total + c.lessonCount,
        done: acc.done + Math.min(c.completedCount, c.lessonCount),
      }),
      { total: 0, done: 0 },
    );
    const certificate = await this.certificates.statusForLevel(userId, level, totals);

    return {
      owned: true,
      courses: courseCards,
      ...(certificate ? { certificate } : {}),
    };
  }

  // Ensure the featured course is unlockable by buying this class (so "Get
  // Class" actually grants access to the curriculum it advertises).
  private async ensureCourseAssigned(
    courseId: string,
    levelId: string,
  ): Promise<void> {
    await this.prisma.courseLevel.upsert({
      where: { courseId_levelId: { courseId, levelId } },
      create: { courseId, levelId },
      update: {},
    });
  }

  // Read the skills JSON column into a clean SkillDTO[].
  private normalizeSkills(raw: unknown): SkillDTO[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (s): s is Record<string, unknown> =>
          !!s && typeof s === 'object' && !Array.isArray(s),
      )
      .map((s) => ({
        title: typeof s.title === 'string' ? s.title : '',
        imageUrl: typeof s.imageUrl === 'string' ? s.imageUrl : null,
      }))
      .filter((s) => s.title.length > 0);
  }

  async create(dto: CreateLevelDto): Promise<LevelDTO> {
    const slug = await this.resolveLevelSlug(dto.slug);
    let stripeProductId: string | null = null;
    const priceRows: {
      stripePriceId: string | null;
      interval: string;
      amount: number;
      currency: string;
      installments: number | null;
    }[] = [];

    // PAID levels get a Stripe Product + a Price per requested interval when
    // Stripe is configured. Under a PayPal-only setup the rows are created
    // without a stripePriceId — PayPal plans provision lazily at checkout
    // (billing/paypal/prepare), and ensureStripePrice backfills if Stripe is
    // connected later.
    if (dto.type === 'PAID' && dto.prices?.length) {
      const stripeOk = await this.stripe.isConfigured();
      if (!stripeOk && !(await this.paypal.isConfigured())) {
        throw new BadRequestException(
          'Connect Stripe or PayPal in Settings before adding prices to a paid class.',
        );
      }
      if (stripeOk) {
        const product = await this.stripe.createProduct(dto.name);
        stripeProductId = product.id;
      }
      for (const price of dto.prices) {
        const currency = price.currency ?? 'usd';
        let stripePriceId: string | null = null;
        if (stripeOk && stripeProductId) {
          const stripePrice = await this.stripe.createPrice({
            productId: stripeProductId,
            interval: price.interval,
            amount: price.amount,
            currency,
          });
          stripePriceId = stripePrice.id;
        }
        priceRows.push({
          stripePriceId,
          interval: price.interval,
          amount: price.amount,
          currency,
          installments: price.installments ?? null,
        });
      }
    }

    const level = await this.prisma.level.create({
      data: {
        name: dto.name,
        slug,
        published: dto.published ?? false,
        type: dto.type,
        mailchimpTags: dto.mailchimpTags ?? undefined,
        mailchimpAudienceId: dto.mailchimpAudienceId ?? null,
        mailchimpAudienceName: dto.mailchimpAudienceName ?? null,
        stripeProductId,
        imageUrl: dto.imageUrl || null,
        description: dto.description || null,
        trailerUrl: dto.trailerUrl || null,
        featuredCourseId: dto.featuredCourseId || null,
        certificateTemplateId: await this.validCertificateTemplateId(
          dto.certificateTemplateId,
        ),
        skills: dto.skills
          ? dto.skills.map((s) => ({
              title: s.title.trim(),
              imageUrl: s.imageUrl || null,
            }))
          : undefined,
        prices: { create: priceRows },
        categories: dto.categoryIds?.length
          ? { connect: dto.categoryIds.map((id) => ({ id })) }
          : undefined,
      },
      include: {
        prices: { where: { active: true } },
        categories: { orderBy: { order: 'asc' } },
      },
    });
    if (dto.featuredCourseId) {
      await this.ensureCourseAssigned(dto.featuredCourseId, level.id);
    }
    return this.toDTO(level as LevelWithPrices);
  }

  async update(id: string, dto: UpdateLevelDto): Promise<LevelDTO> {
    const existing = await this.prisma.level.findUnique({
      where: { id },
      include: { prices: { where: { active: true } } },
    });
    if (!existing) throw new NotFoundException('Level not found');

    // Resolve the checkout slug only when the caller sends one ('' clears it).
    const slug =
      dto.slug !== undefined
        ? await this.resolveLevelSlug(dto.slug, id)
        : undefined;

    const level = await this.prisma.level.update({
      where: { id },
      data: {
        name: dto.name ?? undefined,
        slug,
        published: dto.published !== undefined ? dto.published : undefined,
        type: dto.type ?? undefined,
        mailchimpTags: dto.mailchimpTags ?? undefined,
        // The admin form always submits the full audience selection, so map
        // undefined/empty -> null (clears) and a value -> set.
        mailchimpAudienceId: dto.mailchimpAudienceId ?? null,
        mailchimpAudienceName: dto.mailchimpAudienceName ?? null,
        // Landing-page fields: only touch them when the caller actually sends
        // them (so a partial update can't accidentally blank them).
        imageUrl: dto.imageUrl !== undefined ? dto.imageUrl || null : undefined,
        description:
          dto.description !== undefined ? dto.description || null : undefined,
        trailerUrl:
          dto.trailerUrl !== undefined ? dto.trailerUrl || null : undefined,
        featuredCourseId:
          dto.featuredCourseId !== undefined
            ? dto.featuredCourseId || null
            : undefined,
        certificateTemplateId:
          dto.certificateTemplateId !== undefined
            ? await this.validCertificateTemplateId(dto.certificateTemplateId)
            : undefined,
        skills:
          dto.skills !== undefined
            ? dto.skills.map((s) => ({
                title: s.title.trim(),
                imageUrl: s.imageUrl || null,
              }))
            : undefined,
        // Replace the category set wholesale when the admin form submits it.
        categories:
          dto.categoryIds !== undefined
            ? { set: dto.categoryIds.map((id) => ({ id })) }
            : undefined,
      },
    });
    if (dto.featuredCourseId) {
      await this.ensureCourseAssigned(dto.featuredCourseId, id);
    }

    // Keep the provider product names in step with a rename (PAID levels only).
    // PayPal is best-effort: a stale catalog name must not block the save.
    if (dto.name !== undefined && dto.name !== existing.name) {
      if (existing.stripeProductId) {
        await this.stripe.updateProduct(existing.stripeProductId, level.name);
      }
      if (existing.paypalProductId) {
        try {
          await this.paypal.updateProduct(existing.paypalProductId, level.name);
        } catch (err) {
          this.logger.warn(
            `paypal updateProduct ${existing.paypalProductId} failed: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
    }

    // Reconcile offered prices when the caller sends a `prices` array. A
    // non-PAID level can never carry prices, so its desired set is forced empty
    // (archives anything left over from when it was PAID).
    if (dto.prices !== undefined) {
      const effectiveType = dto.type ?? existing.type;
      const desired = effectiveType === 'PAID' ? dto.prices : [];
      await this.reconcilePrices(
        id,
        level.name,
        existing.stripeProductId,
        existing.prices,
        desired,
      );
    }

    // If the tag set changed, propagate it to Mailchimp for everyone who
    // currently holds this level: activate newly-added tags, deactivate
    // removed ones. (Editing the level reconciles existing members, not just
    // future grants.)
    if (dto.mailchimpTags !== undefined) {
      const before = new Set(existing.mailchimpTags);
      const after = new Set(level.mailchimpTags);
      const added = level.mailchimpTags.filter((t) => !before.has(t));
      const removed = existing.mailchimpTags.filter((t) => !after.has(t));
      if (added.length || removed.length) {
        await this.reconcileLevelTags(
          id,
          level.mailchimpAudienceId ?? undefined,
          added,
          removed,
        );
      }
    }

    // Re-read so the response reflects the post-reconcile (active) price set and
    // any Stripe product id provisioned along the way.
    const fresh = await this.prisma.level.findUniqueOrThrow({
      where: { id },
      include: {
        prices: { where: { active: true } },
        categories: { orderBy: { order: 'asc' } },
      },
    });
    return this.toDTO(fresh as LevelWithPrices);
  }

  /**
   * Reconcile a PAID level's offered prices against the desired set. Stripe
   * Prices are immutable, so this never edits an amount in place:
   *  - a desired (interval+amount+currency) with no active match -> create a new
   *    Stripe Price + local row;
   *  - an active price not in the desired set -> archive it (Stripe active:false
   *    + local active:false) so current subscribers keep it but new checkouts
   *    can't use it.
   * Provisions the Stripe Product on the first price if the level lacks one,
   * persisting the new id back onto the level.
   */
  private async reconcilePrices(
    levelId: string,
    levelName: string,
    productId: string | null,
    existingActive: {
      id: string;
      stripePriceId: string | null;
      paypalPlanId: string | null;
      interval: string;
      amount: number;
      currency: string;
      installments: number | null;
    }[],
    desired: {
      interval: 'month' | 'year';
      amount: number;
      currency?: string;
      installments?: number;
    }[],
  ): Promise<void> {
    // installments is part of a price's identity: a "6 payments then lifetime"
    // plan and an ongoing plan at the same amount/interval are different offers.
    const key = (p: {
      interval: string;
      amount: number;
      currency: string;
      installments: number | null;
    }) => `${p.interval}:${p.amount}:${p.currency.toLowerCase()}:${p.installments ?? ''}`;

    const desiredNorm = desired.map((d) => ({
      interval: d.interval,
      amount: d.amount,
      currency: (d.currency ?? 'usd').toLowerCase(),
      installments: d.installments ?? null,
    }));
    const existingKeys = new Set(existingActive.map(key));
    const desiredKeys = new Set(desiredNorm.map(key));

    const toAdd = desiredNorm.filter((d) => !existingKeys.has(key(d)));
    const toArchive = existingActive.filter((e) => !desiredKeys.has(key(e)));
    if (toAdd.length === 0 && toArchive.length === 0) return; // nothing changed

    // New prices need at least one configured provider. Stripe provisions
    // eagerly here; PayPal plans provision lazily at checkout (paypal/prepare).
    const stripeOk =
      toAdd.length > 0 ? await this.stripe.isConfigured() : false;
    if (toAdd.length > 0 && !stripeOk && !(await this.paypal.isConfigured())) {
      throw new BadRequestException(
        'Connect Stripe or PayPal in Settings before adding prices to a paid class.',
      );
    }

    // A Product must exist before Stripe Prices can be created against it.
    let pid = productId;
    if (toAdd.length > 0 && stripeOk && !pid) {
      const product = await this.stripe.createProduct(levelName);
      pid = product.id;
      await this.prisma.level.update({
        where: { id: levelId },
        data: { stripeProductId: pid },
      });
    }

    for (const d of toAdd) {
      let stripePriceId: string | null = null;
      if (stripeOk && pid) {
        const stripePrice = await this.stripe.createPrice({
          productId: pid,
          interval: d.interval,
          amount: d.amount,
          currency: d.currency,
        });
        stripePriceId = stripePrice.id;
      }
      await this.prisma.price.create({
        data: {
          levelId,
          stripePriceId,
          interval: d.interval,
          amount: d.amount,
          currency: d.currency,
          installments: d.installments ?? null,
        },
      });
    }

    // Archive at every provider that holds the price, best-effort: existing
    // subscriptions keep billing either way, and a provider hiccup (or removed
    // credentials) must not block the admin from editing the catalog.
    for (const e of toArchive) {
      if (e.stripePriceId) {
        try {
          await this.stripe.archivePrice(e.stripePriceId);
        } catch (err) {
          this.logger.warn(
            `archivePrice ${e.stripePriceId} failed: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
      if (e.paypalPlanId) {
        try {
          await this.paypal.deactivatePlan(e.paypalPlanId);
        } catch (err) {
          this.logger.warn(
            `deactivatePlan ${e.paypalPlanId} failed: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
      await this.prisma.price.update({
        where: { id: e.id },
        data: { active: false },
      });
    }
  }

  // Enqueue tag add/remove jobs for every member who currently (ACTIVE) holds
  // the level, so a tag edit syncs to Mailchimp. Deduped per email.
  private async reconcileLevelTags(
    levelId: string,
    audienceId: string | undefined,
    added: string[],
    removed: string[],
  ): Promise<void> {
    const holders = await this.prisma.userLevel.findMany({
      where: { levelId, status: 'ACTIVE' },
      select: { user: { select: { email: true } } },
    });
    const emails = Array.from(new Set(holders.map((h) => h.user.email)));
    await Promise.all(
      emails.flatMap((email) => {
        const jobs: Promise<void>[] = [];
        if (added.length)
          jobs.push(this.mailchimp.enqueueTags('add', email, added, audienceId));
        if (removed.length)
          jobs.push(
            this.mailchimp.enqueueTags('remove', email, removed, audienceId),
          );
        return jobs;
      }),
    );
  }

  async remove(id: string): Promise<{ ok: true }> {
    const existing = await this.prisma.level.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Level not found');
    // Issued-certificate rows cascade with the level; their rendered PDFs
    // don't, so unlink them first (best-effort).
    await this.certificates.unlinkFilesForLevel(id).catch(() => undefined);
    await this.prisma.level.delete({ where: { id } });
    return { ok: true };
  }

  // '' clears the override (-> null); a non-empty id must exist or the save
  // would die later on the FK with an opaque 500.
  private async validCertificateTemplateId(
    value: string | null | undefined,
  ): Promise<string | null> {
    if (!value) return null;
    const row = await this.prisma.certificateTemplate.findUnique({
      where: { id: value },
      select: { id: true },
    });
    if (!row) throw new BadRequestException('Certificate template not found');
    return row.id;
  }

  // ---------- categories (admin-only grouping for classes) ----------

  async listCategories(): Promise<LevelCategoryDTO[]> {
    const cats = await this.prisma.levelCategory.findMany({
      orderBy: { order: 'asc' },
    });
    return cats.map((c) => ({ id: c.id, name: c.name, order: c.order }));
  }

  async createCategory(dto: CreateLevelCategoryDto): Promise<LevelCategoryDTO> {
    const count = await this.prisma.levelCategory.count();
    const cat = await this.prisma.levelCategory.create({
      data: { name: dto.name.trim(), order: dto.order ?? count },
    });
    return { id: cat.id, name: cat.name, order: cat.order };
  }

  async deleteCategory(id: string): Promise<{ ok: true }> {
    const existing = await this.prisma.levelCategory.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Category not found');
    // The implicit M2M join rows are removed automatically; levels are kept.
    await this.prisma.levelCategory.delete({ where: { id } });
    return { ok: true };
  }

  // ---------- checkout slug ----------

  private slugify(input: string): string {
    return input
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '') // strip diacritics
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  // Normalize a requested checkout slug; blank/whitespace -> null (clears it).
  // Rejects a slug already used by another level. `ignoreId` lets a level keep
  // its own slug on update.
  private async resolveLevelSlug(
    raw: string | undefined,
    ignoreId?: string,
  ): Promise<string | null> {
    if (raw === undefined) return null;
    const slug = this.slugify(raw);
    if (!slug) return null;
    const clash = await this.prisma.level.findFirst({
      where: { slug, NOT: ignoreId ? { id: ignoreId } : undefined },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException('That checkout slug is already in use');
    }
    return slug;
  }
}
