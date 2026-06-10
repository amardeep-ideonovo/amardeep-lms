import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import type { SubscriptionRowDTO } from '@lms/types';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

// Column spec for the shared sheet builder. `numFmt` drives Excel cell formatting
// (dates, currency, percentages) so values stay sortable/filterable numbers/dates
// rather than pre-formatted strings.
type Col = { header: string; key: string; width?: number; numFmt?: string };

// Optional, validated export filters. All omittable (omitted = all data). `from`/`to`
// are inclusive calendar-day bounds (UTC); `levelId` scopes to one class/level.
export interface ReportFilter {
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
  levelId?: string;
}
type Range = { gte?: Date; lte?: Date };

// Builds the admin "Reports" exports as Excel (.xlsx) workbooks. Read-only: every
// method just reads existing data and assembles a workbook in memory. Data sources
// are reused where possible (SubscriptionsService for the Stripe-live sheet) and
// queried directly where the UI DTO is too narrow (Members needs emailOptOut etc.).
// Each export is generated on demand; nothing is persisted server-side.
@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  // ---------- public: one workbook per report (+ the combined one) ----------
  // All accept an optional filter (date range + class); omitted = all data.

  async membersWorkbook(filter?: ReportFilter): Promise<Buffer> {
    const wb = this.newWorkbook();
    await this.addMembersSheet(wb, filter);
    return this.toBuffer(wb);
  }

  async subscriptionsWorkbook(filter?: ReportFilter): Promise<Buffer> {
    const wb = this.newWorkbook();
    // Standalone report: surface a Stripe outage as a real error (502) so the admin
    // knows the export is incomplete, rather than handing back an empty file.
    let rows: SubscriptionRowDTO[];
    try {
      rows = await this.subscriptions.list();
    } catch (err) {
      this.logger.error(
        `[reports] subscriptions export failed: ${this.msg(err)}`,
      );
      throw new BadGatewayException(
        'Could not load subscriptions from Stripe. Check the Stripe configuration and try again.',
      );
    }
    this.addSubscriptionsSheet(wb, this.filterSubs(rows, filter));
    return this.toBuffer(wb);
  }

  async engagementWorkbook(filter?: ReportFilter): Promise<Buffer> {
    const wb = this.newWorkbook();
    await this.addEngagementSheet(wb, filter);
    return this.toBuffer(wb);
  }

  // The "Export all" workbook: every report on its own sheet. A Stripe outage
  // DEGRADES the Subscriptions sheet to a note row so Members + Engagement still
  // export — one source being down must never 500 the whole download.
  async allWorkbook(filter?: ReportFilter): Promise<Buffer> {
    const wb = this.newWorkbook();
    await this.addMembersSheet(wb, filter);
    try {
      const rows = await this.subscriptions.list();
      this.addSubscriptionsSheet(wb, this.filterSubs(rows, filter));
    } catch (err) {
      this.logger.warn(
        `[reports] subscriptions sheet degraded (Stripe unavailable): ${this.msg(err)}`,
      );
      this.addNoteSheet(
        wb,
        'Subscriptions',
        'Subscriptions unavailable — Stripe is not configured or could not be reached.',
      );
    }
    await this.addEngagementSheet(wb, filter);
    return this.toBuffer(wb);
  }

  // ---------- sheet builders ----------

  private async addMembersSheet(
    wb: ExcelJS.Workbook,
    filter?: ReportFilter,
  ): Promise<void> {
    // Date range -> signup (createdAt); class -> holds an ACTIVE grant for the level.
    const r = this.range(filter);
    const where: Prisma.UserWhereInput = {};
    if (r.gte || r.lte) {
      where.createdAt = {
        ...(r.gte ? { gte: r.gte } : {}),
        ...(r.lte ? { lte: r.lte } : {}),
      };
    }
    if (filter?.levelId) {
      where.levels = { some: { levelId: filter.levelId, status: 'ACTIVE' } };
    }
    const users = await this.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { levels: { include: { level: true } } },
    });

    const rows = users.map((u) => {
      // Paid-subscription summary — mirrors MembersService.toRow: STRIPE source,
      // prefer an ACTIVE/PAST_DUE grant, else the most recent stripe grant.
      const stripeLevels = u.levels.filter((ul) => ul.source === 'STRIPE');
      const activePaid = stripeLevels.find(
        (ul) => ul.status === 'ACTIVE' || ul.status === 'PAST_DUE',
      );
      const summary = activePaid ?? stripeLevels[0];
      const activeLevels = u.levels.filter((ul) => ul.status === 'ACTIVE');
      return {
        firstName: u.firstName ?? '',
        lastName: u.lastName ?? '',
        email: u.email,
        username: u.username,
        phone: u.phone ?? '',
        registeredAt: u.createdAt,
        emailOptOut: u.emailOptOut ? 'Yes' : 'No',
        activeClassCount: activeLevels.length,
        activeClasses: activeLevels.map((ul) => ul.level.name).join(', '),
        paidPlan: summary?.level.name ?? '',
        paidStatus: summary ? summary.status : '',
        stripeCustomerId: u.stripeCustomerId ?? '',
      };
    });

    this.addSheet(
      wb,
      'Members',
      [
        { header: 'First name', key: 'firstName', width: 16 },
        { header: 'Last name', key: 'lastName', width: 16 },
        { header: 'Email', key: 'email', width: 30 },
        { header: 'Username', key: 'username', width: 20 },
        { header: 'Phone', key: 'phone', width: 16 },
        { header: 'Registered', key: 'registeredAt', width: 14, numFmt: 'yyyy-mm-dd' },
        { header: 'Email opt-out', key: 'emailOptOut', width: 13 },
        { header: 'Active classes', key: 'activeClassCount', width: 13 },
        { header: 'Class names', key: 'activeClasses', width: 36 },
        { header: 'Paid plan', key: 'paidPlan', width: 22 },
        { header: 'Paid status', key: 'paidStatus', width: 13 },
        { header: 'Stripe customer ID', key: 'stripeCustomerId', width: 22 },
      ],
      rows,
    );
  }

  private addSubscriptionsSheet(
    wb: ExcelJS.Workbook,
    subs: SubscriptionRowDTO[],
  ): void {
    const d = (iso: string | null) => (iso ? new Date(iso) : null);
    const rows = subs.map((s) => ({
      memberName: s.memberName,
      memberEmail: s.memberEmail ?? '',
      plan: s.levelName,
      status: s.status,
      paused: s.paused ? 'Yes' : 'No',
      cancelAtPeriodEnd: s.cancelAtPeriodEnd ? 'Yes' : 'No',
      amount: s.amount != null ? s.amount / 100 : null, // minor units -> major
      currency: (s.currency ?? '').toUpperCase(),
      interval: s.interval ?? '',
      orders: s.orders,
      installmentsTotal: s.installmentsTotal ?? '',
      startDate: d(s.startDate),
      nextPayment: d(s.nextPayment),
      lastOrderDate: d(s.lastOrderDate),
      endDate: d(s.endDate),
      subscriptionId: s.id,
    }));

    this.addSheet(
      wb,
      'Subscriptions',
      [
        { header: 'Member', key: 'memberName', width: 22 },
        { header: 'Email', key: 'memberEmail', width: 30 },
        { header: 'Plan', key: 'plan', width: 24 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Paused', key: 'paused', width: 9 },
        { header: 'Cancels at period end', key: 'cancelAtPeriodEnd', width: 19 },
        { header: 'Amount', key: 'amount', width: 12, numFmt: '#,##0.00' },
        { header: 'Currency', key: 'currency', width: 10 },
        { header: 'Interval', key: 'interval', width: 10 },
        { header: 'Orders', key: 'orders', width: 9 },
        { header: 'Installments', key: 'installmentsTotal', width: 12 },
        { header: 'Start', key: 'startDate', width: 14, numFmt: 'yyyy-mm-dd' },
        { header: 'Next payment', key: 'nextPayment', width: 14, numFmt: 'yyyy-mm-dd' },
        { header: 'Last order', key: 'lastOrderDate', width: 14, numFmt: 'yyyy-mm-dd' },
        { header: 'End', key: 'endDate', width: 14, numFmt: 'yyyy-mm-dd' },
        { header: 'Subscription ID', key: 'subscriptionId', width: 24 },
      ],
      rows,
    );
  }

  private async addEngagementSheet(
    wb: ExcelJS.Workbook,
    filter?: ReportFilter,
  ): Promise<void> {
    // Date range scopes which lesson completions COUNT (windowed engagement); the
    // class filter restricts to members holding that class and scopes the metric to
    // that class's courses.
    const r = this.range(filter);
    const progressWhere: Prisma.LessonProgressWhereInput =
      r.gte || r.lte
        ? {
            completedAt: {
              ...(r.gte ? { gte: r.gte } : {}),
              ...(r.lte ? { lte: r.lte } : {}),
            },
          }
        : {};
    // Bulk aggregation — 5 queries assembled in memory (NO per-user N+1; the
    // per-user AccessService helpers would be a query-per-member here).
    const [users, memberships, courseLevels, courses, progress] =
      await Promise.all([
        this.prisma.user.findMany({
          select: { id: true, firstName: true, lastName: true, email: true },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.userLevel.findMany({
          where: { status: 'ACTIVE' },
          select: { userId: true, levelId: true },
        }),
        this.prisma.courseLevel.findMany({
          select: { courseId: true, levelId: true },
        }),
        this.prisma.course.findMany({
          select: { id: true, _count: { select: { lessons: true } } },
        }),
        this.prisma.lessonProgress.findMany({
          where: progressWhere,
          select: {
            userId: true,
            completedAt: true,
            lesson: { select: { courseId: true } },
          },
        }),
      ]);

    // levelId -> set of courseIds it unlocks
    const coursesByLevel = new Map<string, Set<string>>();
    for (const cl of courseLevels) {
      let set = coursesByLevel.get(cl.levelId);
      if (!set) coursesByLevel.set(cl.levelId, (set = new Set()));
      set.add(cl.courseId);
    }
    // courseId -> lesson count
    const lessonCount = new Map<string, number>();
    for (const c of courses) lessonCount.set(c.id, c._count.lessons);
    // userId -> active levelIds
    const levelsByUser = new Map<string, string[]>();
    for (const m of memberships) {
      const arr = levelsByUser.get(m.userId);
      if (arr) arr.push(m.levelId);
      else levelsByUser.set(m.userId, [m.levelId]);
    }
    // userId -> (courseId -> { completed, last completedAt })
    const progByUser = new Map<
      string,
      Map<string, { completed: number; last: Date | null }>
    >();
    for (const p of progress) {
      const cid = p.lesson.courseId;
      let byCourse = progByUser.get(p.userId);
      if (!byCourse) progByUser.set(p.userId, (byCourse = new Map()));
      const cur = byCourse.get(cid) ?? { completed: 0, last: null };
      cur.completed += 1;
      if (!cur.last || p.completedAt > cur.last) cur.last = p.completedAt;
      byCourse.set(cid, cur);
    }

    // Class filter: restrict to members who hold that class (active grant).
    const levelId = filter?.levelId;
    const includedUsers = levelId
      ? users.filter((u) => (levelsByUser.get(u.id) ?? []).includes(levelId))
      : users;

    const rows = includedUsers.map((u) => {
      const activeLevelIds = levelsByUser.get(u.id) ?? [];
      // Accessible courses: scoped to the selected class, else the union over the
      // member's active levels (Set dedups multi-level access).
      const accessible = new Set<string>();
      if (levelId) {
        const cs = coursesByLevel.get(levelId);
        if (cs) for (const cid of cs) accessible.add(cid);
      } else {
        for (const lid of activeLevelIds) {
          const cs = coursesByLevel.get(lid);
          if (cs) for (const cid of cs) accessible.add(cid);
        }
      }
      let totalLessons = 0;
      for (const cid of accessible) totalLessons += lessonCount.get(cid) ?? 0;

      // "completed" scoped to accessible courses so completion can't exceed 100%.
      let lessonsCompleted = 0;
      let lastActivity: Date | null = null;
      const byCourse = progByUser.get(u.id);
      if (byCourse) {
        for (const cid of accessible) {
          const cur = byCourse.get(cid);
          if (!cur) continue;
          lessonsCompleted += cur.completed;
          if (cur.last && (!lastActivity || cur.last > lastActivity)) {
            lastActivity = cur.last;
          }
        }
      }
      const name =
        [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email;
      return {
        name,
        email: u.email,
        activeClasses: activeLevelIds.length,
        accessibleCourses: accessible.size,
        lessonsCompleted,
        totalLessons,
        // Stored as a fraction; the '0%' numFmt renders it as a whole percent.
        completion: totalLessons > 0 ? lessonsCompleted / totalLessons : 0,
        lastActivity,
      };
    });

    this.addSheet(
      wb,
      'Course engagement',
      [
        { header: 'Member', key: 'name', width: 22 },
        { header: 'Email', key: 'email', width: 30 },
        { header: 'Active classes', key: 'activeClasses', width: 13 },
        { header: 'Accessible courses', key: 'accessibleCourses', width: 17 },
        { header: 'Lessons completed', key: 'lessonsCompleted', width: 16 },
        { header: 'Total lessons', key: 'totalLessons', width: 13 },
        { header: 'Completion', key: 'completion', width: 12, numFmt: '0%' },
        { header: 'Last activity', key: 'lastActivity', width: 14, numFmt: 'yyyy-mm-dd' },
      ],
      rows,
    );
  }

  // ---------- low-level helpers ----------

  private newWorkbook(): ExcelJS.Workbook {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'LMS Admin';
    return wb;
  }

  private addSheet(
    wb: ExcelJS.Workbook,
    name: string,
    columns: Col[],
    rows: Record<string, unknown>[],
  ): void {
    const ws = wb.addWorksheet(name, {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    ws.columns = columns.map((c) => ({
      header: c.header,
      key: c.key,
      width: c.width ?? 18,
      style: c.numFmt ? { numFmt: c.numFmt } : {},
    }));
    const header = ws.getRow(1);
    header.font = { bold: true };
    header.alignment = { vertical: 'middle' };
    if (rows.length) ws.addRows(rows);
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: columns.length },
    };
  }

  // A single-cell sheet used when a data source is unavailable (keeps the combined
  // workbook valid + self-explanatory instead of omitting a sheet silently).
  private addNoteSheet(wb: ExcelJS.Workbook, name: string, note: string): void {
    const ws = wb.addWorksheet(name);
    ws.columns = [{ header: name, key: 'note', width: 90 }];
    ws.getRow(1).font = { bold: true };
    ws.addRow({ note });
  }

  private async toBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  private msg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  // ---------- filters ----------

  // Inclusive calendar-day bounds (interpreted as UTC) from validated YYYY-MM-DD.
  // The DTO checks the FORMAT; here we reject impossible dates (e.g. 2026-13-99,
  // 2026-02-30) that would become an Invalid Date and crash the Prisma query —
  // turning a 500 into a clean 400.
  private range(f?: ReportFilter): Range {
    const parse = (s: string | undefined, endOfDay: boolean): Date | undefined => {
      if (!s) return undefined;
      const d = new Date(`${s}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
      // NaN catches month>12 / garbage; the round-trip catches day-overflow that
      // JS silently rolls over (e.g. 2026-02-30 -> 2026-03-02).
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
        throw new BadRequestException(`Invalid date "${s}" — use YYYY-MM-DD.`);
      }
      return d;
    };
    return { gte: parse(f?.from, false), lte: parse(f?.to, true) };
  }

  private inRange(d: Date | null, r: Range): boolean {
    if (!d) return false;
    if (r.gte && d < r.gte) return false;
    if (r.lte && d > r.lte) return false;
    return true;
  }

  // In-memory filter for the Stripe-sourced subscription rows: by class (levelId)
  // and by START date within the range (subs that began in the window).
  private filterSubs(
    subs: SubscriptionRowDTO[],
    f?: ReportFilter,
  ): SubscriptionRowDTO[] {
    const r = this.range(f);
    const dated = !!(r.gte || r.lte);
    return subs.filter((s) => {
      if (f?.levelId && s.levelId !== f.levelId) return false;
      if (dated && !this.inRange(s.startDate ? new Date(s.startDate) : null, r)) {
        return false;
      }
      return true;
    });
  }
}
