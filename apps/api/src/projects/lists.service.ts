import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import type {
  ChatList,
  ChatListField,
  ChatListItem,
  ChatListItemComment,
} from '@prisma/client';
import type {
  ChatFieldType,
  ChatListDTO,
  ChatListSummaryDTO,
  ChatListFieldDTO,
  ChatListFieldOption,
  ChatListFieldOptionInput,
  ChatListItemCommentDTO,
  ChatListItemDTO,
  ChatListItemStatus,
  ChatWorkflowTrigger,
  CreateChatListInput,
  CreateChatListItemInput,
  CreateListFieldInput,
  UpdateChatListItemInput,
  UpdateListFieldInput,
} from '@lms/types';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelsService } from './channels.service';
import { ProjectsGateway } from './projects.gateway';
import { WorkflowsService } from './workflows.service';
import { AuditService } from '../audit/audit.service';
import {
  SECRET_MAX_LENGTH,
  isSealed,
  openSecretValue,
  sealSecretValue,
} from './secret-value.util';

// Item shape with the comment count + (optionally loaded) comments eagerly
// included for serialization.
type ItemWithCount = ChatListItem & {
  _count?: { comments: number };
};

// Slack-Lists-style task boards with rich, user-defined columns (Airtable
// style). A list owns a set of ChatListField definitions; each item carries a
// `values` JSON map keyed by field id, plus a per-item comment thread. The
// legacy fixed columns (status/assigneeAdminId/dueDate) stay alongside the
// custom fields for now. A list may be scoped to a channel or stand alone;
// channel-scoped lists inherit the channel's visibility check.
@Injectable()
export class ListsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly channels: ChannelsService,
    private readonly gateway: ProjectsGateway,
    // Workflows engine (the Slack "Web Queue Workflow" flow). ListsService ->
    // WorkflowsService is a one-way edge: WorkflowsService never injects this
    // service back (it writes ChatMessage rows directly via Prisma), so there's
    // no DI cycle. All trigger fires are best-effort (try/catch) so a workflow
    // failure can never break the list write that fired it.
    private readonly workflows: WorkflowsService,
    // Append-only audit trail — the SECRET reveal endpoint records every call.
    // AuditModule is @Global, so no import is needed in ProjectsModule.
    private readonly audit: AuditService,
  ) {}

  // Wraps a seal/open call so a crypto failure surfaces as a 503 config error
  // rather than a raw 500 — and, critically, never as a null or an empty
  // result. A stored credential we cannot decrypt is RECOVERABLE (fix the key);
  // reporting it as "no secret set" would invite an admin to overwrite it and
  // destroy the only copy. Broader than LiveService's equivalent, which maps
  // only the missing-key message and lets a wrong key fall through as a 500.
  private crypto<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      throw new ServiceUnavailableException(
        msg.includes('SETTINGS_ENC_KEY')
          ? 'Projects secrets need encryption configured (set SETTINGS_ENC_KEY).'
          : 'This secret could not be decrypted — SETTINGS_ENC_KEY may have changed.',
      );
    }
  }

  // ----- Serializers -----

  private toFieldDTO(field: ChatListField): ChatListFieldDTO {
    return {
      id: field.id,
      listId: field.listId,
      key: field.key,
      name: field.name,
      type: field.type as ChatFieldType,
      options: this.readOptions(field.options),
      config: this.readObject(field.config),
      position: field.position,
    };
  }

  // Serialize an item. `fields` is the item's list's CURRENT field set. Values
  // are WHITELISTED against it: a value keyed by a since-deleted field is
  // dropped (so an orphaned SECRET credential can never leak through a dangling
  // key), and SECRET fields are MASKED — their plaintext is omitted from
  // `values` and the field id surfaced in `secretFieldIds` instead, so the
  // cleartext is reachable only through the audited reveal endpoint.
  private toItemDTO(
    item: ItemWithCount,
    fields: { id: string; type: string }[],
  ): ChatListItemDTO {
    const raw = this.readObject(item.values);
    const values: Record<string, unknown> = {};
    const secretFieldIds: string[] = [];
    for (const f of fields) {
      if (!(f.id in raw)) continue;
      if (f.type === 'SECRET') {
        const v = raw[f.id];
        // Only advertise the field as set when it actually holds a secret.
        if (typeof v === 'string' && v.length > 0) secretFieldIds.push(f.id);
        continue; // never emit the plaintext
      }
      // Defense in depth: flipping a column SECRET -> TEXT does not rewrite the
      // stored values, so a sealed blob can sit under a now-plain field. Never
      // surface it (it would be useless ciphertext at best, and re-saving it
      // would overwrite the real secret).
      if (isSealed(raw[f.id])) continue;
      values[f.id] = raw[f.id];
    }
    return {
      id: item.id,
      listId: item.listId,
      title: item.title,
      status: item.status as ChatListItemStatus,
      assigneeAdminId: item.assigneeAdminId,
      dueDate: item.dueDate ? item.dueDate.toISOString() : null,
      position: item.position,
      values,
      secretFieldIds,
      commentCount: item._count?.comments ?? 0,
      createdFromMessageId: item.createdFromMessageId,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private toListDTO(
    list: ChatList & { items: ItemWithCount[]; fields: ChatListField[] },
  ): ChatListDTO {
    return {
      id: list.id,
      channelId: list.channelId,
      name: list.name,
      createdByAdminId: list.createdByAdminId,
      createdAt: list.createdAt.toISOString(),
      updatedAt: list.updatedAt.toISOString(),
      fields: list.fields.map((f) => this.toFieldDTO(f)),
      items: list.items.map((i) => this.toItemDTO(i, list.fields)),
    };
  }

  private toListSummaryDTO(
    list: ChatList & { _count: { items: number } },
  ): ChatListSummaryDTO {
    return {
      id: list.id,
      channelId: list.channelId,
      name: list.name,
      createdByAdminId: list.createdByAdminId,
      createdAt: list.createdAt.toISOString(),
      updatedAt: list.updatedAt.toISOString(),
      itemCount: list._count.items,
    };
  }

  private toCommentDTO(comment: ChatListItemComment): ChatListItemCommentDTO {
    return {
      id: comment.id,
      itemId: comment.itemId,
      authorAdminId: comment.authorAdminId,
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
      editedAt: comment.editedAt ? comment.editedAt.toISOString() : null,
    };
  }

  // ----- Lists -----

  // Standard include for list detail: fields ordered by position, items ordered
  // by position with their (non-deleted) comment counts.
  private readonly listInclude = {
    fields: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
    items: {
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: { _count: { select: { comments: { where: { deletedAt: null } } } } },
    },
  } satisfies Prisma.ChatListInclude;

  async listLists(
    adminId: string,
    channelId?: string,
  ): Promise<ChatListSummaryDTO[]> {
    // Scoping to a channel enforces that channel's visibility.
    if (channelId) await this.channels.assertVisible(adminId, channelId);
    // Picker rows only — id/name/channel/count. The full items[]+fields[]
    // firehose (incl. each item's `values`) belongs to getList(:id); this
    // endpoint is polled and refetched on socket updates, so keep it a count.
    const lists = await this.prisma.chatList.findMany({
      where: channelId ? { channelId } : {},
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { items: true } } },
    });
    return lists.map((l) => this.toListSummaryDTO(l));
  }

  // Single-list read — lets QueueTable load ONE list's detail instead of
  // scanning every list. Its access model MIRRORS listLists' exactly: the
  // `projects` read permission (enforced at the controller) is the whole gate,
  // with deliberately NO per-list channel check — same as the no-channel
  // listLists path, which already returns every list's full detail to any
  // projects-reader. So this exposes nothing listLists doesn't; it just returns
  // far less of it. (Adding assertVisible here would 404 channel-scoped lists
  // that listLists still surfaces in the standalone Lists picker — a surprising
  // divergence; the channel-visibility tightening, if wanted, belongs on the
  // whole read path, not this one endpoint.) 404 on an unknown id.
  async getList(listId: string): Promise<ChatListDTO> {
    const list = await this.prisma.chatList.findUnique({
      where: { id: listId },
      include: this.listInclude,
    });
    if (!list) throw new NotFoundException('List not found');
    return this.toListDTO(
      list as ChatList & { items: ItemWithCount[]; fields: ChatListField[] },
    );
  }

  async createList(
    adminId: string,
    input: CreateChatListInput,
  ): Promise<ChatListDTO> {
    if (input.channelId) {
      await this.channels.assertVisible(adminId, input.channelId);
    }
    const list = await this.prisma.chatList.create({
      data: {
        name: input.name.trim(),
        channelId: input.channelId ?? null,
        createdByAdminId: adminId,
      },
      include: this.listInclude,
    });
    return this.toListDTO(
      list as ChatList & { items: ItemWithCount[]; fields: ChatListField[] },
    );
  }

  // ----- List items -----

  // `createdFromMessageId` is set only by the "message -> task" flow.
  async addItem(
    adminId: string,
    listId: string,
    input: CreateChatListItemInput & { createdFromMessageId?: string },
  ): Promise<ChatListItemDTO> {
    const list = await this.prisma.chatList.findUnique({
      where: { id: listId },
      select: {
        id: true,
        channelId: true,
        fields: { select: { id: true, type: true } },
      },
    });
    if (!list) throw new NotFoundException('List not found');
    if (list.channelId) await this.channels.assertVisible(adminId, list.channelId);

    // Optional custom-field values are validated against this list's fields.
    const values = input.values
      ? await this.validateValues(listId, input.values)
      : undefined;

    // Default new items to the bottom of the list.
    const last = await this.prisma.chatListItem.findFirst({
      where: { listId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const item = await this.prisma.chatListItem.create({
      data: {
        listId,
        title: input.title.trim(),
        status: input.status ?? 'TODO',
        assigneeAdminId: input.assigneeAdminId ?? null,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        position: (last?.position ?? -1) + 1,
        ...(values !== undefined
          ? { values: values as unknown as Prisma.InputJsonValue }
          : {}),
        createdFromMessageId: input.createdFromMessageId ?? null,
      },
      include: { _count: { select: { comments: { where: { deletedAt: null } } } } },
    });
    this.gateway.emitListUpdate(list.channelId, listId);
    // Best-effort: fire ITEM_CREATED workflows (auto-post into the channel). A
    // workflow failure must never fail the create, so swallow everything.
    await this.fireWorkflow('ITEM_CREATED', item.id, adminId);
    return this.toItemDTO(item, list.fields);
  }

  // Run the workflows engine for an item without ever throwing back into the
  // list write that triggered it.
  private async fireWorkflow(
    trigger: ChatWorkflowTrigger,
    itemId: string,
    actorAdminId: string,
  ): Promise<void> {
    try {
      await this.workflows.fireForItem(trigger, itemId, actorAdminId);
    } catch {
      // Intentionally ignored — workflows are a side-effect, not a precondition.
    }
  }

  async updateItem(
    adminId: string,
    itemId: string,
    input: UpdateChatListItemInput,
  ): Promise<ChatListItemDTO> {
    const item = await this.prisma.chatListItem.findUnique({
      where: { id: itemId },
      include: {
        list: {
          select: {
            channelId: true,
            fields: { select: { id: true, type: true } },
          },
        },
      },
    });
    if (!item) throw new NotFoundException('List item not found');
    if (item.list.channelId) {
      await this.channels.assertVisible(adminId, item.list.channelId);
    }
    const updated = await this.prisma.chatListItem.update({
      where: { id: itemId },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.assigneeAdminId !== undefined
          ? { assigneeAdminId: input.assigneeAdminId }
          : {}),
        ...(input.dueDate !== undefined
          ? { dueDate: input.dueDate ? new Date(input.dueDate) : null }
          : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
      },
      include: { _count: { select: { comments: { where: { deletedAt: null } } } } },
    });
    this.gateway.emitListUpdate(item.list.channelId, item.listId);
    return this.toItemDTO(updated, item.list.fields);
  }

  async deleteItem(adminId: string, itemId: string): Promise<{ ok: true }> {
    const item = await this.prisma.chatListItem.findUnique({
      where: { id: itemId },
      include: { list: { select: { channelId: true } } },
    });
    if (!item) throw new NotFoundException('List item not found');
    if (item.list.channelId) {
      await this.channels.assertVisible(adminId, item.list.channelId);
    }
    await this.prisma.chatListItem.delete({ where: { id: itemId } });
    this.gateway.emitListUpdate(item.list.channelId, item.listId);
    return { ok: true };
  }

  // Merge custom-field values into an item. Each value is validated against its
  // field's type; unknown field ids and type mismatches are rejected (400).
  async updateItemValues(
    adminId: string,
    itemId: string,
    incoming: Record<string, unknown>,
  ): Promise<ChatListItemDTO> {
    const item = await this.prisma.chatListItem.findUnique({
      where: { id: itemId },
      include: {
        list: {
          select: {
            channelId: true,
            fields: { select: { id: true, name: true, type: true } },
          },
        },
      },
    });
    if (!item) throw new NotFoundException('List item not found');
    if (item.list.channelId) {
      await this.channels.assertVisible(adminId, item.list.channelId);
    }
    const before = this.readObject(item.values);
    const validated = await this.validateValues(item.listId, incoming);
    // Merge over the existing values (a partial PATCH, not a replace).
    const merged = { ...before, ...validated };
    const updated = await this.prisma.chatListItem.update({
      where: { id: itemId },
      data: { values: merged as unknown as Prisma.InputJsonValue },
      include: { _count: { select: { comments: { where: { deletedAt: null } } } } },
    });
    this.gateway.emitListUpdate(item.list.channelId, item.listId);

    // ITEM_ASSIGNED: best-effort fire when the "Assignee" PERSON field changed
    // to a (new, non-empty) admin id in this PATCH. We compare the value before
    // vs after the merge so a no-op write doesn't re-fire.
    const assigneeField = item.list.fields.find(
      (f) => f.type === 'PERSON' && f.name.trim().toLowerCase() === 'assignee',
    );
    if (assigneeField && assigneeField.id in validated) {
      const next = merged[assigneeField.id];
      const prev = before[assigneeField.id];
      if (typeof next === 'string' && next && next !== prev) {
        await this.fireWorkflow('ITEM_ASSIGNED', itemId, adminId);
      }
    }
    return this.toItemDTO(updated, item.list.fields);
  }

  // Reveal a single SECRET custom-field value in plaintext. This is the ONLY
  // path that returns an unmasked secret, so the controller gates it at edit
  // level (stricter than the read that lists items) and it is audited on every
  // call. Scoped to exactly one field of one item.
  async revealSecret(
    adminId: string,
    itemId: string,
    fieldId: string,
    ip?: string | null,
  ): Promise<{ value: string | null }> {
    const item = await this.prisma.chatListItem.findUnique({
      where: { id: itemId },
      include: {
        list: {
          select: {
            channelId: true,
            fields: { select: { id: true, type: true } },
          },
        },
      },
    });
    if (!item) throw new NotFoundException('List item not found');
    if (item.list.channelId) {
      await this.channels.assertVisible(adminId, item.list.channelId);
    }
    const field = item.list.fields.find((f) => f.id === fieldId);
    if (!field || field.type !== 'SECRET') {
      throw new NotFoundException('Secret field not found');
    }
    const stored = this.readObject(item.values)[fieldId];
    // Audit BEFORE decrypting: an attempt that fails on a missing/rotated key
    // is still an attempt to read a credential and must leave a trail.
    await this.audit.write({
      actorAdminId: adminId,
      action: 'projects.secret.reveal',
      targetType: 'chat_list_item',
      targetId: itemId,
      metadata: { fieldId, listId: item.listId },
      ip,
    });
    // Sealed values decrypt; values stored before at-rest encryption shipped
    // come back as-is (see openSecretValue).
    return { value: this.crypto(() => openSecretValue(stored)) };
  }

  // ----- List fields (custom columns) -----

  async createField(
    adminId: string,
    listId: string,
    input: CreateListFieldInput,
  ): Promise<ChatListFieldDTO> {
    const list = await this.prisma.chatList.findUnique({
      where: { id: listId },
      select: { id: true, channelId: true },
    });
    if (!list) throw new NotFoundException('List not found');
    if (list.channelId) await this.channels.assertVisible(adminId, list.channelId);

    const type: ChatFieldType = input.type ?? 'TEXT';
    const options = this.normalizeOptions(type, input.options);
    const key = await this.uniqueKey(listId, input.name);

    // Default to the bottom of the column order when no position is given.
    const position =
      input.position ??
      ((
        await this.prisma.chatListField.findFirst({
          where: { listId },
          orderBy: { position: 'desc' },
          select: { position: true },
        })
      )?.position ?? -1) + 1;

    const field = await this.prisma.chatListField.create({
      data: {
        listId,
        key,
        name: input.name.trim(),
        type,
        options: options as unknown as Prisma.InputJsonValue,
        config: (input.config ?? {}) as unknown as Prisma.InputJsonValue,
        position,
      },
    });
    this.gateway.emitListUpdate(list.channelId, listId);
    return this.toFieldDTO(field);
  }

  async updateField(
    adminId: string,
    fieldId: string,
    input: UpdateListFieldInput,
  ): Promise<ChatListFieldDTO> {
    const field = await this.prisma.chatListField.findUnique({
      where: { id: fieldId },
      include: { list: { select: { id: true, channelId: true } } },
    });
    if (!field) throw new NotFoundException('List field not found');
    if (field.list.channelId) {
      await this.channels.assertVisible(adminId, field.list.channelId);
    }
    // If the type is changing, re-normalize options against the new type;
    // otherwise normalize against the existing type when options are supplied.
    const nextType: ChatFieldType = input.type ?? (field.type as ChatFieldType);
    const data: Prisma.ChatListFieldUpdateInput = {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.config !== undefined
        ? { config: input.config as unknown as Prisma.InputJsonValue }
        : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
    };
    if (input.options !== undefined || input.type !== undefined) {
      const baseOptions =
        input.options !== undefined
          ? input.options
          : this.readOptions(field.options);
      data.options = this.normalizeOptions(
        nextType,
        baseOptions,
      ) as unknown as Prisma.InputJsonValue;
    }
    const updated = await this.prisma.chatListField.update({
      where: { id: fieldId },
      data,
    });
    this.gateway.emitListUpdate(field.list.channelId, field.list.id);
    return this.toFieldDTO(updated);
  }

  async deleteField(adminId: string, fieldId: string): Promise<{ ok: true }> {
    const field = await this.prisma.chatListField.findUnique({
      where: { id: fieldId },
      include: { list: { select: { id: true, channelId: true } } },
    });
    if (!field) throw new NotFoundException('List field not found');
    if (field.list.channelId) {
      await this.channels.assertVisible(adminId, field.list.channelId);
    }
    await this.prisma.chatListField.delete({ where: { id: fieldId } });
    this.gateway.emitListUpdate(field.list.channelId, field.list.id);
    return { ok: true };
  }

  async reorderFields(
    adminId: string,
    listId: string,
    orderedFieldIds: string[],
  ): Promise<ChatListFieldDTO[]> {
    const list = await this.prisma.chatList.findUnique({
      where: { id: listId },
      select: { id: true, channelId: true },
    });
    if (!list) throw new NotFoundException('List not found');
    if (list.channelId) await this.channels.assertVisible(adminId, list.channelId);

    const fields = await this.prisma.chatListField.findMany({
      where: { listId },
      select: { id: true },
    });
    const known = new Set(fields.map((f) => f.id));
    // Every id must belong to this list; reject foreign/unknown ids.
    for (const id of orderedFieldIds) {
      if (!known.has(id)) {
        throw new BadRequestException(`Unknown field id: ${id}`);
      }
    }
    // Persist the new order; ids omitted from the payload keep their relative
    // order after the listed ones (sorted by their old position via the read).
    await this.prisma.$transaction(
      orderedFieldIds.map((id, index) =>
        this.prisma.chatListField.update({
          where: { id },
          data: { position: index },
        }),
      ),
    );
    const fresh = await this.prisma.chatListField.findMany({
      where: { listId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
    this.gateway.emitListUpdate(list.channelId, listId);
    return fresh.map((f) => this.toFieldDTO(f));
  }

  // ----- Per-item comments (the 💬 thread) -----

  async listComments(
    adminId: string,
    itemId: string,
  ): Promise<ChatListItemCommentDTO[]> {
    const item = await this.prisma.chatListItem.findUnique({
      where: { id: itemId },
      include: { list: { select: { channelId: true } } },
    });
    if (!item) throw new NotFoundException('List item not found');
    if (item.list.channelId) {
      await this.channels.assertVisible(adminId, item.list.channelId);
    }
    const comments = await this.prisma.chatListItemComment.findMany({
      where: { itemId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return comments.map((c) => this.toCommentDTO(c));
  }

  async addComment(
    adminId: string,
    itemId: string,
    body: string,
  ): Promise<ChatListItemCommentDTO> {
    const item = await this.prisma.chatListItem.findUnique({
      where: { id: itemId },
      include: { list: { select: { channelId: true } } },
    });
    if (!item) throw new NotFoundException('List item not found');
    if (item.list.channelId) {
      await this.channels.assertVisible(adminId, item.list.channelId);
    }
    const comment = await this.prisma.chatListItemComment.create({
      data: { itemId, authorAdminId: adminId, body: body.trim() },
    });
    this.gateway.emitListUpdate(item.list.channelId, item.listId);
    return this.toCommentDTO(comment);
  }

  async updateComment(
    adminId: string,
    commentId: string,
    body: string,
  ): Promise<ChatListItemCommentDTO> {
    const comment = await this.loadOwnComment(adminId, commentId);
    const updated = await this.prisma.chatListItemComment.update({
      where: { id: commentId },
      data: { body: body.trim(), editedAt: new Date() },
    });
    this.gateway.emitListUpdate(comment.channelId, comment.listId);
    return this.toCommentDTO(updated);
  }

  async deleteComment(
    adminId: string,
    commentId: string,
  ): Promise<{ ok: true }> {
    const comment = await this.loadOwnComment(adminId, commentId);
    await this.prisma.chatListItemComment.update({
      where: { id: commentId },
      data: { deletedAt: new Date() },
    });
    this.gateway.emitListUpdate(comment.channelId, comment.listId);
    return { ok: true };
  }

  // Loads a comment the caller authored (and asserts channel visibility),
  // throwing 404 if missing/already-deleted or not the author.
  private async loadOwnComment(
    adminId: string,
    commentId: string,
  ): Promise<{ channelId: string | null; listId: string }> {
    const comment = await this.prisma.chatListItemComment.findUnique({
      where: { id: commentId },
      include: {
        item: { include: { list: { select: { channelId: true, id: true } } } },
      },
    });
    if (!comment || comment.deletedAt) {
      throw new NotFoundException('Comment not found');
    }
    // Only the author may edit/delete their own comment.
    if (comment.authorAdminId !== adminId) {
      throw new NotFoundException('Comment not found');
    }
    if (comment.item.list.channelId) {
      await this.channels.assertVisible(adminId, comment.item.list.channelId);
    }
    return {
      channelId: comment.item.list.channelId,
      listId: comment.item.listId,
    };
  }

  // ----- Value validation -----

  // Validates an incoming { fieldId: value } map against the list's field
  // definitions. Rejects unknown field ids and type mismatches with 400.
  // Returns the (unchanged-but-verified) map ready to merge/store.
  private async validateValues(
    listId: string,
    incoming: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const fields = await this.prisma.chatListField.findMany({
      where: { listId },
    });
    const byId = new Map(fields.map((f) => [f.id, f]));
    const out: Record<string, unknown> = {};
    for (const [fieldId, value] of Object.entries(incoming)) {
      const field = byId.get(fieldId);
      if (!field) {
        throw new BadRequestException(`Unknown field id: ${fieldId}`);
      }
      const normalized = this.validateValue(
        field.type as ChatFieldType,
        this.readOptions(field.options),
        field.name,
        value,
      );
      if (field.type === 'SECRET' && typeof normalized === 'string') {
        // THE single encrypt site: both writers (addItem, updateItemValues)
        // funnel through here, so plaintext never reaches the database.
        // '' means "clear the cell" — sealing it would yield a non-empty
        // ciphertext that toItemDTO would then report as a secret being set.
        out[fieldId] =
          normalized === ''
            ? null
            : this.crypto(() => sealSecretValue(normalized));
      } else {
        out[fieldId] = normalized;
      }
    }
    return out;
  }

  // Validates a single value against a field's type. A null/undefined value is
  // always allowed (clears the cell). Returns the normalized value to store.
  private validateValue(
    type: ChatFieldType,
    options: ChatListFieldOption[],
    fieldName: string,
    value: unknown,
  ): unknown {
    if (value === null || value === undefined) return null;
    const bad = (expected: string): never => {
      throw new BadRequestException(
        `Field "${fieldName}" expects ${expected}`,
      );
    };
    switch (type) {
      case 'TEXT':
      case 'LONG_TEXT':
      case 'URL':
        if (typeof value !== 'string') bad('a string');
        return value;
      case 'SECRET': {
        if (typeof value !== 'string') bad('a string');
        const s = value as string;
        // Capped because sealing inflates the stored value. Deliberately NOT
        // trimmed — leading/trailing whitespace can be meaningful in a
        // credential. Sealing happens in validateValues, not here: this method
        // is a pure sync validator and an unwrapped crypto throw would surface
        // as a raw 500 instead of the mapped 503.
        if (s.length > SECRET_MAX_LENGTH) {
          bad(`at most ${SECRET_MAX_LENGTH} characters`);
        }
        return s;
      }
      case 'PERSON':
        // An admin id is an opaque string; existence is the caller's concern.
        if (typeof value !== 'string') bad('an admin id string');
        return value;
      case 'MULTI_PERSON': {
        // Multiple assignees — an array of admin id strings.
        if (!Array.isArray(value)) bad('an array of admin id strings');
        const ids = value as unknown[];
        for (const id of ids) {
          if (typeof id !== 'string') bad('an array of admin id strings');
        }
        return ids;
      }
      case 'NUMBER':
        if (typeof value !== 'number' || Number.isNaN(value)) bad('a number');
        return value;
      case 'CHECKBOX':
        if (typeof value !== 'boolean') bad('a boolean');
        return value;
      case 'DATE': {
        if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
          bad('an ISO date string');
        }
        return value;
      }
      case 'SELECT': {
        if (typeof value !== 'string') bad('an option id');
        if (!options.some((o) => o.id === value)) bad('a valid option id');
        return value;
      }
      case 'MULTI_SELECT': {
        if (!Array.isArray(value)) bad('an array of option ids');
        const ids = value as unknown[];
        for (const id of ids) {
          if (typeof id !== 'string' || !options.some((o) => o.id === id)) {
            bad('an array of valid option ids');
          }
        }
        return ids;
      }
      default:
        return value;
    }
  }

  // ----- Helpers -----

  // Normalizes SELECT/MULTI_SELECT options: generates an id for any option that
  // lacks one and trims labels. Non-select fields carry no options.
  private normalizeOptions(
    type: ChatFieldType,
    options?: ChatListFieldOptionInput[],
  ): ChatListFieldOption[] {
    if (type !== 'SELECT' && type !== 'MULTI_SELECT') return [];
    if (!options) return [];
    return options.map((o) => ({
      id: o.id && o.id.trim() ? o.id : randomUUID(),
      label: o.label.trim(),
      color: o.color ?? null,
    }));
  }

  // Generates a slug from the field name and ensures it's unique within the
  // list (suffixing -2, -3, … on collision).
  private async uniqueKey(listId: string, name: string): Promise<string> {
    const base =
      name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 48) || 'field';
    const existing = await this.prisma.chatListField.findMany({
      where: { listId, key: { startsWith: base } },
      select: { key: true },
    });
    const taken = new Set(existing.map((f) => f.key));
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}_${n}`)) n += 1;
    return `${base}_${n}`;
  }

  // ----- JSON readers (Prisma Json -> typed) -----

  private readObject(value: Prisma.JsonValue): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private readOptions(value: Prisma.JsonValue): ChatListFieldOption[] {
    if (!Array.isArray(value)) return [];
    const out: ChatListFieldOption[] = [];
    for (const entry of value) {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const o = entry as Record<string, unknown>;
        if (typeof o.id === 'string' && typeof o.label === 'string') {
          out.push({
            id: o.id,
            label: o.label,
            color: typeof o.color === 'string' ? o.color : null,
          });
        }
      }
    }
    return out;
  }
}
