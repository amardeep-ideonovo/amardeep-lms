import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CreateMenuInput,
  MenuDTO,
  MenuItemDTO,
  MenuItemInput,
  MenuItemType,
  MenuItemVisibility,
  MenuListItem,
  MenuLocation,
  ReorderMenuItemsInput,
  ResolvedMenu,
  ResolvedMenuItem,
  UpdateMenuInput,
} from '@lms/types';
import { PrismaService } from '../prisma/prisma.service';
import { buildHrefMaps, resolveHref } from './menu-href.util';

// Canonical value sets (the API can't import @lms/types runtime values).
const LOCATIONS = ['HEADER', 'FOOTER', 'MOBILE'] as const;
const ITEM_TYPES = [
  'PAGE',
  'CLASS',
  'CLASS_INDEX',
  'COURSE',
  'COURSE_INDEX',
  'BLOG_INDEX',
  'BLOG_POST',
  'ROUTE',
  'CUSTOM',
] as const;
const VISIBILITIES = ['ALL', 'GUEST', 'AUTHED', 'LEVEL'] as const;

type MenuItemRow = Prisma.MenuItemGetPayload<Record<string, never>>;

@Injectable()
export class MenusService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- validation helpers ----------
  private validLocation(loc: unknown): MenuLocation | null {
    return typeof loc === 'string' && (LOCATIONS as readonly string[]).includes(loc)
      ? (loc as MenuLocation)
      : null;
  }
  private validType(t: unknown): MenuItemType | null {
    return typeof t === 'string' && (ITEM_TYPES as readonly string[]).includes(t)
      ? (t as MenuItemType)
      : null;
  }
  private validVisibility(v: unknown): MenuItemVisibility {
    return typeof v === 'string' &&
      (VISIBILITIES as readonly string[]).includes(v)
      ? (v as MenuItemVisibility)
      : 'ALL';
  }

  // Keep only the target field(s) relevant to the item type; null the rest.
  private targetData(type: MenuItemType, input: Partial<MenuItemInput>) {
    const d = {
      url: null as string | null,
      pageId: null as string | null,
      levelId: null as string | null,
      courseId: null as string | null,
      postId: null as string | null,
    };
    if (type === 'PAGE') d.pageId = input.pageId || null;
    else if (type === 'CLASS') d.levelId = input.levelId || null;
    else if (type === 'COURSE') d.courseId = input.courseId || null;
    else if (type === 'BLOG_POST') d.postId = input.postId || null;
    else if (type === 'ROUTE' || type === 'CUSTOM')
      d.url = (input.url ?? '').trim() || null;
    // BLOG_INDEX has no target.
    return d;
  }

  // ---------- tree builders (admin DTO) ----------
  private toItemDTO(
    row: MenuItemRow,
    byParent: Map<string | null, MenuItemRow[]>,
  ): MenuItemDTO {
    const kids = (byParent.get(row.id) ?? []).sort((a, b) => a.order - b.order);
    return {
      id: row.id,
      parentId: row.parentId,
      order: row.order,
      label: row.label,
      type: row.type as MenuItemType,
      url: row.url,
      pageId: row.pageId,
      levelId: row.levelId,
      courseId: row.courseId,
      postId: row.postId,
      openNewTab: row.openNewTab,
      visibility: row.visibility as MenuItemVisibility,
      visibilityLevelId: row.visibilityLevelId,
      children: kids.map((k) => this.toItemDTO(k, byParent)),
    };
  }

  private async buildMenuDTO(menuId: string): Promise<MenuDTO> {
    const menu = await this.prisma.menu.findUnique({ where: { id: menuId } });
    if (!menu) throw new NotFoundException('Menu not found');
    const items = await this.prisma.menuItem.findMany({
      where: { menuId },
      orderBy: { order: 'asc' },
    });
    const byParent = new Map<string | null, MenuItemRow[]>();
    for (const it of items) {
      const arr = byParent.get(it.parentId) ?? [];
      arr.push(it);
      byParent.set(it.parentId, arr);
    }
    const roots = (byParent.get(null) ?? []).sort((a, b) => a.order - b.order);
    return {
      id: menu.id,
      name: menu.name,
      location: menu.location as MenuLocation | null,
      items: roots.map((r) => this.toItemDTO(r, byParent)),
      createdAt: menu.createdAt.toISOString(),
    };
  }

  // ---------- admin CRUD ----------
  async list(): Promise<MenuListItem[]> {
    const menus = await this.prisma.menu.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { items: true } } },
    });
    return menus.map((m) => ({
      id: m.id,
      name: m.name,
      location: m.location as MenuLocation | null,
      itemCount: m._count.items,
    }));
  }

  get(id: string): Promise<MenuDTO> {
    return this.buildMenuDTO(id);
  }

  async create(dto: CreateMenuInput): Promise<MenuDTO> {
    const name = (dto.name ?? '').trim();
    if (!name) throw new BadRequestException('Name is required');
    const location = this.validLocation(dto.location);
    const menu = await this.prisma.$transaction(async (tx) => {
      if (location)
        await tx.menu.updateMany({ where: { location }, data: { location: null } });
      return tx.menu.create({ data: { name: name.slice(0, 120), location } });
    });
    return this.buildMenuDTO(menu.id);
  }

  async update(id: string, dto: UpdateMenuInput): Promise<MenuDTO> {
    const existing = await this.prisma.menu.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Menu not found');

    const data: Prisma.MenuUpdateInput = {};
    if (dto.name !== undefined) {
      const n = (dto.name ?? '').trim();
      if (!n) throw new BadRequestException('Name is required');
      data.name = n.slice(0, 120);
    }
    const setLocation =
      dto.location === undefined
        ? undefined
        : dto.location === null
          ? null
          : this.validLocation(dto.location);

    await this.prisma.$transaction(async (tx) => {
      if (setLocation)
        await tx.menu.updateMany({
          where: { location: setLocation, id: { not: id } },
          data: { location: null },
        });
      if (setLocation !== undefined) data.location = setLocation;
      if (Object.keys(data).length)
        await tx.menu.update({ where: { id }, data });
    });
    return this.buildMenuDTO(id);
  }

  async remove(id: string): Promise<{ ok: true }> {
    const existing = await this.prisma.menu.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Menu not found');
    await this.prisma.menu.delete({ where: { id } }); // cascades items
    return { ok: true };
  }

  async addItem(menuId: string, input: MenuItemInput): Promise<MenuDTO> {
    const menu = await this.prisma.menu.findUnique({ where: { id: menuId } });
    if (!menu) throw new NotFoundException('Menu not found');
    const type = this.validType(input.type);
    if (!type) throw new BadRequestException('Invalid item type');
    const label = (input.label ?? '').trim();
    if (!label) throw new BadRequestException('Label is required');

    let parentId: string | null = null;
    if (input.parentId) {
      const parent = await this.prisma.menuItem.findUnique({
        where: { id: input.parentId },
      });
      if (!parent || parent.menuId !== menuId)
        throw new BadRequestException('Invalid parent item');
      parentId = parent.id;
    }
    const order = await this.prisma.menuItem.count({
      where: { menuId, parentId },
    });
    const visibility = this.validVisibility(input.visibility);
    await this.prisma.menuItem.create({
      data: {
        menuId,
        parentId,
        order,
        label: label.slice(0, 200),
        type,
        ...this.targetData(type, input),
        openNewTab: !!input.openNewTab,
        visibility,
        visibilityLevelId:
          visibility === 'LEVEL' ? input.visibilityLevelId || null : null,
      },
    });
    return this.buildMenuDTO(menuId);
  }

  async updateItem(
    itemId: string,
    input: Partial<MenuItemInput>,
  ): Promise<MenuDTO> {
    const item = await this.prisma.menuItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Item not found');

    const data: Prisma.MenuItemUpdateInput = {};
    if (input.label !== undefined) {
      const l = (input.label ?? '').trim();
      if (!l) throw new BadRequestException('Label is required');
      data.label = l.slice(0, 200);
    }
    const nextType =
      input.type !== undefined
        ? this.validType(input.type)
        : (item.type as MenuItemType);
    if (input.type !== undefined) {
      if (!nextType) throw new BadRequestException('Invalid item type');
      data.type = nextType;
    }
    const targetTouched =
      input.type !== undefined ||
      input.url !== undefined ||
      input.pageId !== undefined ||
      input.levelId !== undefined ||
      input.courseId !== undefined ||
      input.postId !== undefined;
    if (targetTouched) {
      const t = (nextType ?? (item.type as MenuItemType)) as MenuItemType;
      Object.assign(
        data,
        this.targetData(t, {
          url: input.url ?? item.url,
          pageId: input.pageId ?? item.pageId,
          levelId: input.levelId ?? item.levelId,
          courseId: input.courseId ?? item.courseId,
          postId: input.postId ?? item.postId,
        }),
      );
    }
    if (input.openNewTab !== undefined) data.openNewTab = !!input.openNewTab;
    if (input.visibility !== undefined) {
      const v = this.validVisibility(input.visibility);
      data.visibility = v;
      data.visibilityLevelId =
        v === 'LEVEL'
          ? input.visibilityLevelId ?? item.visibilityLevelId ?? null
          : null;
    } else if (
      input.visibilityLevelId !== undefined &&
      item.visibility === 'LEVEL'
    ) {
      data.visibilityLevelId = input.visibilityLevelId || null;
    }

    await this.prisma.menuItem.update({ where: { id: itemId }, data });
    return this.buildMenuDTO(item.menuId);
  }

  async deleteItem(itemId: string): Promise<MenuDTO> {
    const item = await this.prisma.menuItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Item not found');
    await this.prisma.menuItem.delete({ where: { id: itemId } }); // cascades children
    return this.buildMenuDTO(item.menuId);
  }

  async reorder(
    menuId: string,
    input: ReorderMenuItemsInput,
  ): Promise<MenuDTO> {
    const owned = await this.prisma.menuItem.findMany({
      where: { menuId },
      select: { id: true },
    });
    const ids = new Set(owned.map((i) => i.id));
    const nodes = (input.items ?? []).filter((n) => ids.has(n.id));

    // Resolve parents to within-menu ids (or null) and reject cycles.
    const parentOf = new Map<string, string | null>();
    for (const n of nodes) {
      parentOf.set(n.id, n.parentId && ids.has(n.parentId) ? n.parentId : null);
    }
    for (const id of parentOf.keys()) {
      let cur = parentOf.get(id) ?? null;
      let hops = 0;
      while (cur) {
        if (cur === id) throw new BadRequestException('Cyclic menu nesting');
        cur = parentOf.get(cur) ?? null;
        if (++hops > 1000) break;
      }
    }
    await this.prisma.$transaction(
      nodes.map((n) =>
        this.prisma.menuItem.update({
          where: { id: n.id },
          data: { parentId: parentOf.get(n.id) ?? null, order: n.order },
        }),
      ),
    );
    return this.buildMenuDTO(menuId);
  }

  // ---------- public resolve (visibility-filtered, hrefs computed) ----------
  async resolveByLocation(
    location: string,
    userId?: string,
  ): Promise<ResolvedMenu | null> {
    const loc = this.validLocation(location);
    if (!loc) return null;
    const menu = await this.prisma.menu.findUnique({ where: { location: loc } });
    return menu ? this.resolveMenu(menu.id, userId) : null;
  }

  async resolveById(id: string, userId?: string): Promise<ResolvedMenu | null> {
    const menu = await this.prisma.menu.findUnique({ where: { id } });
    return menu ? this.resolveMenu(menu.id, userId) : null;
  }

  private async resolveMenu(
    menuId: string,
    userId?: string,
  ): Promise<ResolvedMenu> {
    const menu = await this.prisma.menu.findUniqueOrThrow({
      where: { id: menuId },
    });
    const items = await this.prisma.menuItem.findMany({
      where: { menuId },
      orderBy: { order: 'asc' },
    });

    const authed = !!userId;
    let owned = new Set<string>();
    if (userId) {
      const uls = await this.prisma.userLevel.findMany({
        where: { userId, status: 'ACTIVE' },
        select: { levelId: true },
      });
      owned = new Set(uls.map((u) => u.levelId));
    }
    const canSee = (it: MenuItemRow): boolean => {
      switch (it.visibility) {
        case 'GUEST':
          return !authed;
        case 'AUTHED':
          return authed;
        case 'LEVEL':
          return (
            authed && !!it.visibilityLevelId && owned.has(it.visibilityLevelId)
          );
        default:
          return true; // ALL
      }
    };

    // Resolve target hrefs via the shared resolver (the same logic the header
    // CTA resolver uses, so equivalent targets produce identical hrefs).
    const maps = await buildHrefMaps(this.prisma, items);

    const byParent = new Map<string | null, MenuItemRow[]>();
    for (const it of items) {
      const a = byParent.get(it.parentId) ?? [];
      a.push(it);
      byParent.set(it.parentId, a);
    }
    const build = (parentId: string | null): ResolvedMenuItem[] =>
      (byParent.get(parentId) ?? [])
        .filter(canSee)
        .sort((a, b) => a.order - b.order)
        .map((it): ResolvedMenuItem | null => {
          const href = resolveHref(it, maps);
          if (!href) return null;
          return {
            id: it.id,
            label: it.label,
            href,
            newTab: it.openNewTab,
            children: build(it.id),
          };
        })
        .filter((x): x is ResolvedMenuItem => x !== null);

    return {
      id: menu.id,
      name: menu.name,
      location: menu.location as MenuLocation | null,
      items: build(null),
    };
  }
}
