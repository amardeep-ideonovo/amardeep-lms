import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  PopupAdminRow,
  PopupAnimation,
  PopupBehaviorDTO,
  PopupEventType,
  PopupFrequency,
  PopupListItem,
  PopupPageMode,
  PopupPosition,
  PopupPublicDTO,
  PopupStatus,
  PopupStyleDTO,
  PopupTrigger,
  PuckComponentData,
  PuckDocument,
} from '@lms/types';
import type { Prisma } from '@prisma/client';
import sanitizeHtml from 'sanitize-html';
import { ALLOWED_STYLES } from '../common/sanitize-styles';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePopupDto, UpdatePopupDto } from './dto/popup.dto';

// Popups render on PUBLIC surfaces (member areas + CMS pages), so — exactly
// like Pages — any rich-text HTML embedded in the Puck document is sanitized on
// write. Structural blocks render through trusted React components in @lms/puck,
// so their text props need no sanitization (React escapes them at render time).
const SANITIZE_OPTS: sanitizeHtml.IOptions = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'blockquote', 'a', 'ul', 'ol',
    'li', 'b', 'i', 'strong', 'em', 's', 'strike', 'code', 'pre', 'hr', 'br',
    'span', 'img', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tr',
    'th', 'td',
  ],
  allowedAttributes: {
    a: ['href', 'name', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    '*': ['style'],
  },
  allowedStyles: ALLOWED_STYLES,
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  transformTags: {
    a: sanitizeHtml.simpleTransform(
      'a',
      { rel: 'noopener noreferrer', target: '_blank' },
      true,
    ),
  },
};

const EMPTY_DOC: PuckDocument = { content: [], root: { props: {} } };

// Shape we read back for mapping.
type PopupRow = {
  id: string;
  name: string;
  data: Prisma.JsonValue;
  status: PopupStatus;
  width: string;
  height: string;
  background: string;
  position: PopupPosition;
  borderColor: string;
  borderRadius: number;
  padding: number;
  showOnDashboard: boolean;
  showOnClasses: boolean;
  showOnCourses: boolean;
  showOnLessons: boolean;
  pageMode: PopupPageMode;
  pageIds: string[];
  trigger: PopupTrigger;
  triggerValue: number;
  frequency: PopupFrequency;
  frequencyDays: number;
  closeOnOverlay: boolean;
  animation: PopupAnimation;
  views: number;
  clicks: number;
  dismissals: number;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class PopupsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- public targeting ----------

  // Member-area surface -> the popup flag that turns it on.
  private static readonly SURFACE_FLAG: Record<
    string,
    keyof Pick<
      PopupRow,
      'showOnDashboard' | 'showOnClasses' | 'showOnCourses' | 'showOnLessons'
    >
  > = {
    dashboard: 'showOnDashboard',
    classes: 'showOnClasses',
    courses: 'showOnCourses',
    lessons: 'showOnLessons',
  };

  // Return the ACTIVE popups that should show in a given context. The server
  // does ALL the visibility filtering so the client just renders what it gets.
  //   context=dashboard|classes|courses|lessons -> the matching showOn* flag
  //   context=page & pageId=<id>                -> popups whose pageMode matches
  async listActive(
    context?: string,
    pageId?: string,
  ): Promise<PopupPublicDTO[]> {
    const active = (await this.prisma.popup.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { updatedAt: 'desc' },
    })) as PopupRow[];

    const matched = active.filter((p) => {
      const flag = context ? PopupsService.SURFACE_FLAG[context] : undefined;
      if (flag) return p[flag];
      if (context === 'page') {
        switch (p.pageMode) {
          case 'ALL':
            return true;
          case 'INCLUDE':
            return !!pageId && p.pageIds.includes(pageId);
          case 'EXCLUDE':
            return !!pageId && !p.pageIds.includes(pageId);
          default:
            return false; // NONE
        }
      }
      return false;
    });

    return matched.map((p) => this.toPublic(p));
  }

  // ---------- admin CRUD ----------

  async adminList(): Promise<PopupListItem[]> {
    const popups = (await this.prisma.popup.findMany({
      orderBy: { updatedAt: 'desc' },
    })) as PopupRow[];
    return popups.map((p) => this.toListItem(p));
  }

  async adminGet(id: string): Promise<PopupAdminRow> {
    const popup = (await this.prisma.popup.findUnique({
      where: { id },
    })) as PopupRow | null;
    if (!popup) throw new NotFoundException('Popup not found');
    return this.toAdminRow(popup);
  }

  async adminCreate(dto: CreatePopupDto): Promise<PopupAdminRow> {
    const popup = (await this.prisma.popup.create({
      data: {
        name: dto.name.trim(),
        data: this.sanitizeDoc(dto.data),
        status: dto.status ?? undefined,
        width: dto.width ?? undefined,
        height: dto.height ?? undefined,
        background: dto.background ?? undefined,
        position: dto.position ?? undefined,
        borderColor: dto.borderColor ?? undefined,
        borderRadius: dto.borderRadius ?? undefined,
        padding: dto.padding ?? undefined,
        showOnDashboard: dto.showOnDashboard ?? undefined,
        showOnClasses: dto.showOnClasses ?? undefined,
        showOnCourses: dto.showOnCourses ?? undefined,
        showOnLessons: dto.showOnLessons ?? undefined,
        pageMode: dto.pageMode ?? undefined,
        pageIds: dto.pageIds ?? undefined,
        trigger: dto.trigger ?? undefined,
        triggerValue: dto.triggerValue ?? undefined,
        frequency: dto.frequency ?? undefined,
        frequencyDays: dto.frequencyDays ?? undefined,
        closeOnOverlay: dto.closeOnOverlay ?? undefined,
        animation: dto.animation ?? undefined,
      },
    })) as PopupRow;
    return this.toAdminRow(popup);
  }

  async adminUpdate(id: string, dto: UpdatePopupDto): Promise<PopupAdminRow> {
    const existing = await this.prisma.popup.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Popup not found');

    const popup = (await this.prisma.popup.update({
      where: { id },
      data: {
        name: dto.name?.trim() ?? undefined,
        data: dto.data !== undefined ? this.sanitizeDoc(dto.data) : undefined,
        status: dto.status ?? undefined,
        width: dto.width ?? undefined,
        height: dto.height ?? undefined,
        background: dto.background ?? undefined,
        position: dto.position ?? undefined,
        borderColor: dto.borderColor ?? undefined,
        borderRadius: dto.borderRadius ?? undefined,
        padding: dto.padding ?? undefined,
        // booleans: `false ?? undefined` is false (kept); only `undefined` skips.
        showOnDashboard: dto.showOnDashboard ?? undefined,
        showOnClasses: dto.showOnClasses ?? undefined,
        showOnCourses: dto.showOnCourses ?? undefined,
        showOnLessons: dto.showOnLessons ?? undefined,
        pageMode: dto.pageMode ?? undefined,
        pageIds: dto.pageIds ?? undefined,
        trigger: dto.trigger ?? undefined,
        triggerValue: dto.triggerValue ?? undefined,
        frequency: dto.frequency ?? undefined,
        frequencyDays: dto.frequencyDays ?? undefined,
        closeOnOverlay: dto.closeOnOverlay ?? undefined,
        animation: dto.animation ?? undefined,
      },
    })) as PopupRow;
    return this.toAdminRow(popup);
  }

  async adminDelete(id: string): Promise<{ ok: true }> {
    const existing = await this.prisma.popup.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Popup not found');
    await this.prisma.popup.delete({ where: { id } });
    return { ok: true };
  }

  // ---------- analytics (public, fire-and-forget) ----------

  // Increment a counter. `updateMany` so an unknown/deleted id is a silent no-op
  // (the renderer never blocks on this), and a spammed event can't 500.
  async recordEvent(
    id: string,
    type: PopupEventType,
  ): Promise<{ ok: true }> {
    const field =
      type === 'view' ? 'views' : type === 'click' ? 'clicks' : 'dismissals';
    await this.prisma.popup.updateMany({
      where: { id },
      data: { [field]: { increment: 1 } },
    });
    return { ok: true };
  }

  // ---------- sanitization (mirrors PagesService) ----------

  // Deep-walk the Puck document and sanitize any `html` string (the RichText
  // block's prop) wherever it appears — including blocks nested inside slots.
  private sanitizeHtmlDeep(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((v) => this.sanitizeHtmlDeep(v));
    }
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] =
          k === 'html' && typeof v === 'string'
            ? sanitizeHtml(v, SANITIZE_OPTS)
            : this.sanitizeHtmlDeep(v);
      }
      return out;
    }
    return value;
  }

  private sanitizeDoc(input: unknown): Prisma.InputJsonValue {
    const doc = (
      input && typeof input === 'object' ? input : EMPTY_DOC
    ) as PuckDocument;
    const cleaned = this.sanitizeHtmlDeep(doc) as Partial<PuckDocument>;
    return {
      root:
        cleaned.root && typeof cleaned.root === 'object'
          ? cleaned.root
          : { props: {} },
      content: Array.isArray(cleaned.content) ? cleaned.content : [],
      zones:
        cleaned.zones && typeof cleaned.zones === 'object' ? cleaned.zones : {},
    } as unknown as Prisma.InputJsonValue;
  }

  // Normalize whatever JSON is in the column back into a valid Puck envelope.
  private asDoc(data: Prisma.JsonValue): PuckDocument {
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const d = data as { content?: unknown; root?: unknown; zones?: unknown };
      return {
        content: Array.isArray(d.content)
          ? (d.content as PuckComponentData[])
          : [],
        root: (d.root && typeof d.root === 'object'
          ? d.root
          : { props: {} }) as PuckDocument['root'],
        zones: (d.zones && typeof d.zones === 'object'
          ? d.zones
          : {}) as PuckDocument['zones'],
      };
    }
    return { content: [], root: { props: {} } };
  }

  // ---------- mappers ----------

  private toStyle(p: PopupRow): PopupStyleDTO {
    return {
      width: p.width,
      height: p.height,
      background: p.background,
      position: p.position,
      borderColor: p.borderColor,
      borderRadius: p.borderRadius,
      padding: p.padding,
    };
  }

  private toBehavior(p: PopupRow): PopupBehaviorDTO {
    return {
      trigger: p.trigger,
      triggerValue: p.triggerValue,
      frequency: p.frequency,
      frequencyDays: p.frequencyDays,
      closeOnOverlay: p.closeOnOverlay,
      animation: p.animation,
    };
  }

  private toPublic(p: PopupRow): PopupPublicDTO {
    return {
      id: p.id,
      name: p.name,
      data: this.asDoc(p.data),
      style: this.toStyle(p),
      behavior: this.toBehavior(p),
    };
  }

  private toListItem(p: PopupRow): PopupListItem {
    return {
      id: p.id,
      name: p.name,
      status: p.status,
      position: p.position,
      showOnDashboard: p.showOnDashboard,
      showOnClasses: p.showOnClasses,
      showOnCourses: p.showOnCourses,
      showOnLessons: p.showOnLessons,
      pageMode: p.pageMode,
      pageCount: p.pageIds.length,
      views: p.views,
      clicks: p.clicks,
      dismissals: p.dismissals,
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  private toAdminRow(p: PopupRow): PopupAdminRow {
    return {
      id: p.id,
      name: p.name,
      data: this.asDoc(p.data),
      status: p.status,
      width: p.width,
      height: p.height,
      background: p.background,
      position: p.position,
      borderColor: p.borderColor,
      borderRadius: p.borderRadius,
      padding: p.padding,
      showOnDashboard: p.showOnDashboard,
      showOnClasses: p.showOnClasses,
      showOnCourses: p.showOnCourses,
      showOnLessons: p.showOnLessons,
      pageMode: p.pageMode,
      pageIds: p.pageIds,
      trigger: p.trigger,
      triggerValue: p.triggerValue,
      frequency: p.frequency,
      frequencyDays: p.frequencyDays,
      closeOnOverlay: p.closeOnOverlay,
      animation: p.animation,
      views: p.views,
      clicks: p.clicks,
      dismissals: p.dismissals,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }
}
