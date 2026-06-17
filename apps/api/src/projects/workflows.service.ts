import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  ChatList,
  ChatListField,
  ChatListItem,
  ChatWorkflow,
} from '@prisma/client';
import type {
  ChatFieldType,
  ChatMessageDTO,
  ChatMessageListItemCardDTO,
  ChatMessageListItemFieldDTO,
  ChatWorkflowConfig,
  ChatWorkflowDTO,
  ChatWorkflowTrigger,
  CreateWorkflowInput,
  UpdateWorkflowInput,
} from '@lms/types';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelsService } from './channels.service';
import { ProjectsGateway } from './projects.gateway';

// ----------------------------------------------------------------------------
// Workflows: the Slack "Web Queue Workflow" — WHEN a list item is created or
// assigned, AUTO-POST a templated, @mentioned message (with an inline item card)
// into the list's channel.
//
// DI: this service depends ONLY on PrismaService + ChannelsService +
// ProjectsGateway. It must NOT depend on ListsService / MessagesService —
// ListsService depends on THIS service (it calls fireForItem after a write), so
// a back-edge would create a cycle. To post a message it writes ChatMessage
// rows directly via Prisma (mirroring MessagesService.createMessage's shape)
// rather than calling MessagesService.
//
// The dependency graph stays acyclic:
//   ListsService -> WorkflowsService -> { ProjectsGateway -> ChannelsService }
// (no edge from WorkflowsService back to ListsService).
// ----------------------------------------------------------------------------

@Injectable()
export class WorkflowsService {
  private readonly logger = new Logger(WorkflowsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly channels: ChannelsService,
    private readonly gateway: ProjectsGateway,
  ) {}

  // ----- Serializer -----

  private toDTO(wf: ChatWorkflow): ChatWorkflowDTO {
    return {
      id: wf.id,
      name: wf.name,
      listId: wf.listId,
      channelId: wf.channelId,
      trigger: wf.trigger as ChatWorkflowTrigger,
      config: this.readConfig(wf.config),
      enabled: wf.enabled,
      createdByAdminId: wf.createdByAdminId,
      createdAt: wf.createdAt.toISOString(),
      updatedAt: wf.updatedAt.toISOString(),
    };
  }

  // ----- CRUD -----

  async list(adminId: string, listId?: string): Promise<ChatWorkflowDTO[]> {
    // Scoping to a list enforces the owning channel's visibility (if any).
    if (listId) {
      const list = await this.prisma.chatList.findUnique({
        where: { id: listId },
        select: { id: true, channelId: true },
      });
      if (!list) throw new NotFoundException('List not found');
      if (list.channelId) {
        await this.channels.assertVisible(adminId, list.channelId);
      }
    }
    const rows = await this.prisma.chatWorkflow.findMany({
      where: listId ? { listId } : {},
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((w) => this.toDTO(w));
  }

  async create(
    adminId: string,
    input: CreateWorkflowInput,
  ): Promise<ChatWorkflowDTO> {
    const list = await this.prisma.chatList.findUnique({
      where: { id: input.listId },
      select: { id: true, channelId: true },
    });
    if (!list) throw new NotFoundException('List not found');
    if (list.channelId) await this.channels.assertVisible(adminId, list.channelId);

    // If an explicit post target is given, the admin must be able to see it.
    if (input.channelId) {
      await this.channels.assertVisible(adminId, input.channelId);
    }

    const wf = await this.prisma.chatWorkflow.create({
      data: {
        name: input.name.trim(),
        listId: input.listId,
        channelId: input.channelId ?? null,
        trigger: input.trigger,
        config: (input.config ?? {}) as unknown as Prisma.InputJsonValue,
        createdByAdminId: adminId,
      },
    });
    return this.toDTO(wf);
  }

  async update(
    adminId: string,
    id: string,
    input: UpdateWorkflowInput,
  ): Promise<ChatWorkflowDTO> {
    const wf = await this.loadVisible(adminId, id);
    if (input.channelId) {
      await this.channels.assertVisible(adminId, input.channelId);
    }
    const updated = await this.prisma.chatWorkflow.update({
      where: { id: wf.id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.channelId !== undefined ? { channelId: input.channelId } : {}),
        ...(input.trigger !== undefined ? { trigger: input.trigger } : {}),
        ...(input.config !== undefined
          ? { config: input.config as unknown as Prisma.InputJsonValue }
          : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      },
    });
    return this.toDTO(updated);
  }

  async remove(adminId: string, id: string): Promise<{ ok: true }> {
    const wf = await this.loadVisible(adminId, id);
    await this.prisma.chatWorkflow.delete({ where: { id: wf.id } });
    return { ok: true };
  }

  // Loads a workflow and asserts the caller can see its list's channel.
  private async loadVisible(
    adminId: string,
    id: string,
  ): Promise<ChatWorkflow> {
    const wf = await this.prisma.chatWorkflow.findUnique({
      where: { id },
      include: { list: { select: { channelId: true } } },
    });
    if (!wf) throw new NotFoundException('Workflow not found');
    if (wf.list.channelId) {
      await this.channels.assertVisible(adminId, wf.list.channelId);
    }
    return wf;
  }

  // ----- ENGINE -----

  // Fire every enabled workflow that matches `trigger` for the given item. This
  // is best-effort: the caller (ListsService) wraps it in try/catch, and each
  // workflow is also individually isolated so one failure never blocks another.
  async fireForItem(
    trigger: ChatWorkflowTrigger,
    itemId: string,
    actorAdminId: string,
  ): Promise<void> {
    const item = await this.prisma.chatListItem.findUnique({
      where: { id: itemId },
      include: {
        list: { include: { fields: { orderBy: { position: 'asc' } } } },
      },
    });
    if (!item) return; // item gone (deleted in the same breath) — nothing to do.

    const workflows = await this.prisma.chatWorkflow.findMany({
      where: { listId: item.listId, trigger, enabled: true },
    });
    if (workflows.length === 0) return;

    const list = item.list as ChatList & { fields: ChatListField[] };
    const fields = list.fields;

    for (const wf of workflows) {
      try {
        await this.runWorkflow(wf, item, list, fields, actorAdminId);
      } catch (err) {
        // Isolate per-workflow: log and continue so a bad template/config can't
        // wedge the others (or, via the caller's catch, the originating write).
        this.logger.warn(
          `Workflow ${wf.id} failed for item ${itemId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  private async runWorkflow(
    wf: ChatWorkflow,
    item: ChatListItem,
    list: ChatList,
    fields: ChatListField[],
    actorAdminId: string,
  ): Promise<void> {
    const trigger = wf.trigger as ChatWorkflowTrigger;
    const dedupeKey = `wf:${wf.id}:item:${item.id}:${trigger}`;

    // Idempotency: a unique ChatWorkflowRun per (workflow, item, trigger). If
    // one already exists, this fire is a duplicate (re-create, retried PATCH,
    // double-trigger) — skip silently.
    const existing = await this.prisma.chatWorkflowRun.findUnique({
      where: { dedupeKey },
      select: { id: true },
    });
    if (existing) return;

    // Resolve the post target: the workflow's explicit channel, else the list's.
    const targetChannelId = wf.channelId ?? list.channelId;
    if (!targetChannelId) return; // nowhere to post — skip.

    const config = this.readConfig(wf.config);
    const values = this.readObject(item.values);

    // The assignee admin id: the configured PERSON field, or the one named
    // "Assignee" (case-insensitive). Used for the @mention + a card highlight.
    // Assignee(s): the configured/"Assignee" field may be a single PERSON or a
    // MULTI_PERSON array — normalize to a list so we @mention everyone.
    const assigneeField = this.resolveAssigneeField(fields, config);
    const rawAssignee = assigneeField ? values[assigneeField.id] : null;
    const assigneeAdminIds: string[] = Array.isArray(rawAssignee)
      ? (rawAssignee.filter((v) => typeof v === 'string') as string[])
      : typeof rawAssignee === 'string'
        ? [rawAssignee]
        : [];
    const assigneeAdminId = assigneeAdminIds[0] ?? null;

    // Build the message body from the (default or override) template.
    const body = this.renderBody({
      template: config.template,
      actorAdminId,
      assigneeAdminId,
      title: item.title,
      fields,
      values,
    });

    // Mentions: every assignee (deduped).
    const mentioned = [...new Set(assigneeAdminIds)];

    // The inline item card is on by default; config.includeCard === false opts
    // out (no listItemId => the serializer attaches no card).
    const includeCard = config.includeCard !== false;

    // Create the ChatMessage DIRECTLY via Prisma (NOT MessagesService — see the
    // DI note at the top). Shape mirrors MessagesService.createMessage so the
    // serializer + gateway treat it identically, plus listItemId + workflowId.
    const message = await this.prisma.chatMessage.create({
      data: {
        channelId: targetChannelId,
        authorAdminId: actorAdminId,
        body,
        listItemId: includeCard ? item.id : null,
        workflowId: wf.id,
        ...(mentioned.length
          ? {
              mentions: {
                create: mentioned.map((mentionedAdminId) => ({
                  mentionedAdminId,
                })),
              },
            }
          : {}),
      },
      include: {
        reactions: true,
        _count: { select: { replies: true } },
      },
    });

    // Record the run (idempotency marker + provenance). The unique dedupeKey
    // also guards a race: a concurrent duplicate fire hits the unique and we
    // swallow it below (the message it would post is the only collateral).
    try {
      await this.prisma.chatWorkflowRun.create({
        data: {
          workflowId: wf.id,
          itemId: item.id,
          dedupeKey,
          messageId: message.id,
          status: 'OK',
        },
      });
    } catch (err) {
      // Unique violation => another fire won the race. Roll back our message so
      // we don't double-post, then bail.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        await this.prisma.chatMessage
          .delete({ where: { id: message.id } })
          .catch(() => undefined);
        return;
      }
      throw err;
    }

    // Stream it live to the channel room, exactly as a normal send would. The
    // enriched DTO (card + workflow author) is built from the row + the list.
    const dto = this.buildMessageDTO(message, {
      itemId: item.id,
      listId: list.id,
      title: item.title,
      fields,
      values,
      workflowId: wf.id,
      workflowName: wf.name,
      includeCard,
    });
    this.gateway.emitMessage(dto);
  }

  // ----- Public DTO enrichment helpers (used by MessagesService) -----

  // For a batch of (messageId -> {listItemId, workflowId}) referenced by chat
  // messages, load the item cards + workflow names in two queries. Returns maps
  // the message serializer merges in. Centralizing this here keeps Messages
  // Service free of list/workflow query logic and avoids N+1s.
  async loadMessageEnrichments(
    refs: {
      listItemIds: string[];
      workflowIds: string[];
    },
  ): Promise<{
    cards: Map<string, ChatMessageListItemCardDTO>;
    workflowNames: Map<string, string>;
  }> {
    const cards = new Map<string, ChatMessageListItemCardDTO>();
    const workflowNames = new Map<string, string>();

    const itemIds = [...new Set(refs.listItemIds)];
    const wfIds = [...new Set(refs.workflowIds)];

    if (itemIds.length) {
      const items = await this.prisma.chatListItem.findMany({
        where: { id: { in: itemIds } },
        include: {
          list: { include: { fields: { orderBy: { position: 'asc' } } } },
        },
      });
      for (const it of items) {
        const list = it.list as ChatList & { fields: ChatListField[] };
        cards.set(
          it.id,
          this.buildCard({
            itemId: it.id,
            listId: it.listId,
            title: it.title,
            fields: list.fields,
            values: this.readObject(it.values),
          }),
        );
      }
    }

    if (wfIds.length) {
      const wfs = await this.prisma.chatWorkflow.findMany({
        where: { id: { in: wfIds } },
        select: { id: true, name: true },
      });
      for (const w of wfs) workflowNames.set(w.id, w.name);
    }

    return { cards, workflowNames };
  }

  // ----- Rendering -----

  // The default template (overridable via config.template). One line per field,
  // Slack-mrkdwn-ish. `{actor}`/`{assignee}` become <@id> mentions; `{title}`
  // the item title; `{field:Name}` the rendered value of a named column. A line
  // whose only placeholder resolves to empty is dropped.
  private renderBody(args: {
    template?: string;
    actorAdminId: string;
    assigneeAdminId: string | null;
    title: string;
    fields: ChatListField[];
    values: Record<string, unknown>;
  }): string {
    const { template, actorAdminId, assigneeAdminId, title, fields, values } =
      args;

    if (template && template.trim()) {
      return this.applyTemplate(template, {
        actorAdminId,
        assigneeAdminId,
        title,
        fields,
        values,
      });
    }

    // Default template — built line by line so absent fields drop cleanly.
    const lines: string[] = ['*Project Added to Queue*'];
    lines.push(`Assigned by: ${this.mention(actorAdminId)}`);
    if (assigneeAdminId) {
      lines.push(`Assigned to: ${this.mention(assigneeAdminId)}`);
    }
    lines.push(`Name: ${title}`);

    // Category: the SELECT field named "Category" -> its option label.
    const category = this.findField(fields, 'Category');
    if (category) {
      const rendered = this.renderValue(category, values[category.id]);
      if (rendered) lines.push(`Category: ${rendered}`);
    }
    // Due: the DATE field named "Due" / "Due date" -> a readable date.
    const due =
      this.findField(fields, 'Due') ?? this.findField(fields, 'Due date');
    if (due) {
      const rendered = this.renderValue(due, values[due.id]);
      if (rendered) lines.push(`Due: ${rendered}`);
    }

    return lines.join('\n');
  }

  // Substitute {actor} {assignee} {title} {field:Name} in a custom template.
  // A line that, after substitution, is empty (or just its label) is kept as-is
  // for custom templates — the operator owns their format. Unknown placeholders
  // resolve to "".
  private applyTemplate(
    template: string,
    ctx: {
      actorAdminId: string;
      assigneeAdminId: string | null;
      title: string;
      fields: ChatListField[];
      values: Record<string, unknown>;
    },
  ): string {
    return template.replace(/\{([^}]+)\}/g, (_m, rawKey: string) => {
      const key = rawKey.trim();
      if (key === 'actor') return this.mention(ctx.actorAdminId);
      if (key === 'assignee')
        return ctx.assigneeAdminId ? this.mention(ctx.assigneeAdminId) : '';
      if (key === 'title') return ctx.title;
      if (key.startsWith('field:')) {
        const name = key.slice('field:'.length).trim();
        const field = this.findField(ctx.fields, name);
        if (!field) return '';
        return this.renderValue(field, ctx.values[field.id]) ?? '';
      }
      return '';
    });
  }

  // Render a single field value for the message body. SELECT -> option label;
  // PERSON -> a <@id> mention; DATE -> a readable date; others -> their string.
  // Returns null for absent/empty values (so the caller can drop the line).
  private renderValue(field: ChatListField, value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null;
    const type = field.type as ChatFieldType;
    switch (type) {
      case 'SELECT': {
        const opt = this.readOptions(field.options).find((o) => o.id === value);
        return opt ? opt.label : null;
      }
      case 'MULTI_SELECT': {
        if (!Array.isArray(value)) return null;
        const opts = this.readOptions(field.options);
        const labels = value
          .map((id) => opts.find((o) => o.id === id)?.label)
          .filter((l): l is string => !!l);
        return labels.length ? labels.join(', ') : null;
      }
      case 'PERSON':
        return typeof value === 'string' ? this.mention(value) : null;
      case 'DATE': {
        if (typeof value !== 'string') return null;
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return null;
        return d.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        });
      }
      case 'CHECKBOX':
        return value === true ? 'Yes' : 'No';
      case 'SECRET':
        return null; // never render a secret into a channel message.
      default:
        return typeof value === 'string' || typeof value === 'number'
          ? String(value)
          : null;
    }
  }

  // A Slack-style <@adminId> mention token. The client's renderBody highlights
  // these the same way it highlights @handles.
  private mention(adminId: string): string {
    return `<@${adminId}>`;
  }

  // ----- Card building -----

  // Build the compact inline card from an item + its list fields. Only non-empty
  // cells are included (SECRET is always excluded). SELECT resolves to its
  // {label,color}; PERSON keeps the admin id (the UI resolves the name).
  private buildCard(args: {
    itemId: string;
    listId: string;
    title: string;
    fields: ChatListField[];
    values: Record<string, unknown>;
  }): ChatMessageListItemCardDTO {
    const cardFields: ChatMessageListItemFieldDTO[] = [];
    for (const f of args.fields) {
      if (f.type === 'SECRET') continue;
      const raw = args.values[f.id];
      if (raw === null || raw === undefined || raw === '') continue;
      if (Array.isArray(raw) && raw.length === 0) continue;
      const type = f.type as ChatFieldType;
      const cardField: ChatMessageListItemFieldDTO = {
        name: f.name,
        type,
        value: raw,
      };
      if (type === 'SELECT') {
        const opt = this.readOptions(f.options).find((o) => o.id === raw);
        if (opt) {
          cardField.label = opt.label;
          cardField.color = opt.color ?? null;
        }
      }
      cardFields.push(cardField);
    }
    return {
      itemId: args.itemId,
      listId: args.listId,
      title: args.title,
      fields: cardFields,
    };
  }

  // Assemble a full ChatMessageDTO for a freshly-created workflow message. Mirror
  // of MessagesService.toMessageDTO + the workflow/card enrichment, so the engine
  // can emit a self-contained live DTO without a round-trip through Messages
  // Service (which would re-introduce the DI edge we're avoiding).
  private buildMessageDTO(
    message: {
      id: string;
      seq: number;
      channelId: string;
      authorAdminId: string;
      body: string;
      parentMessageId: string | null;
      createdAt: Date;
      editedAt: Date | null;
      deletedAt: Date | null;
      reactions: { emoji: string; adminId: string }[];
      _count: { replies: number };
    },
    enrich: {
      itemId: string;
      listId: string;
      title: string;
      fields: ChatListField[];
      values: Record<string, unknown>;
      workflowId: string;
      workflowName: string;
      includeCard: boolean;
    },
  ): ChatMessageDTO {
    const byEmoji = new Map<string, string[]>();
    for (const r of message.reactions) {
      const ids = byEmoji.get(r.emoji);
      if (ids) ids.push(r.adminId);
      else byEmoji.set(r.emoji, [r.adminId]);
    }
    return {
      id: message.id,
      seq: message.seq,
      channelId: message.channelId,
      authorAdminId: message.authorAdminId,
      body: message.body,
      parentMessageId: message.parentMessageId,
      createdAt: message.createdAt.toISOString(),
      editedAt: message.editedAt ? message.editedAt.toISOString() : null,
      deletedAt: message.deletedAt ? message.deletedAt.toISOString() : null,
      reactions: [...byEmoji.entries()].map(([emoji, adminIds]) => ({
        emoji,
        adminIds,
      })),
      replyCount: message._count.replies,
      workflowId: enrich.workflowId,
      workflowName: enrich.workflowName,
      listItemCard: enrich.includeCard
        ? this.buildCard({
            itemId: enrich.itemId,
            listId: enrich.listId,
            title: enrich.title,
            fields: enrich.fields,
            values: enrich.values,
          })
        : null,
    };
  }

  // ----- Field resolution -----

  // The assignee PERSON field: config.assigneeFieldId if set + present, else the
  // first PERSON field named "Assignee" (case-insensitive).
  private resolveAssigneeField(
    fields: ChatListField[],
    config: ChatWorkflowConfig,
  ): ChatListField | null {
    if (config.assigneeFieldId) {
      const byId = fields.find((f) => f.id === config.assigneeFieldId);
      if (byId) return byId;
    }
    return (
      fields.find(
        (f) =>
          (f.type === 'PERSON' || f.type === 'MULTI_PERSON') &&
          f.name.trim().toLowerCase() === 'assignee',
      ) ?? null
    );
  }

  private findField(
    fields: ChatListField[],
    name: string,
  ): ChatListField | null {
    const target = name.trim().toLowerCase();
    return fields.find((f) => f.name.trim().toLowerCase() === target) ?? null;
  }

  // ----- JSON readers -----

  private readConfig(value: Prisma.JsonValue): ChatWorkflowConfig {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const o = value as Record<string, unknown>;
      const config: ChatWorkflowConfig = {};
      if (typeof o.assigneeFieldId === 'string')
        config.assigneeFieldId = o.assigneeFieldId;
      if (typeof o.template === 'string') config.template = o.template;
      if (typeof o.includeCard === 'boolean') config.includeCard = o.includeCard;
      return config;
    }
    return {};
  }

  private readObject(value: Prisma.JsonValue): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private readOptions(
    value: Prisma.JsonValue,
  ): { id: string; label: string; color: string | null }[] {
    if (!Array.isArray(value)) return [];
    const out: { id: string; label: string; color: string | null }[] = [];
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
