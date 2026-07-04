import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  FormAdminRow,
  FormFieldDef,
  FormPublicDTO,
  FormStatus,
  FormSubmissionDTO,
  FormSubmitResult,
} from '@lms/types';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ContactsService } from '../contacts/contacts.service';
import { CreateFormDto, UpdateFormDto } from './dto/form.dto';

type FormRow = {
  id: string;
  name: string;
  fields: Prisma.JsonValue;
  audienceId: string | null;
  audience?: { name: string } | null;
  doubleOptIn: boolean;
  updateExisting: boolean;
  tags: string[];
  successMessage: string | null;
  redirectUrl: string | null;
  status: FormStatus;
  createdAt: Date;
  updatedAt: Date;
  _count?: { submissions: number };
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class FormsService {
  private readonly logger = new Logger(FormsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: ContactsService,
  ) {}

  // NOTE: the form editor's audience picker + field mapper read OUR in-house
  // list directly via the canonical contacts endpoints (GET /admin/audiences and
  // /admin/audiences/:id/fields). This service writes form opt-ins straight into
  // the in-house contacts list.

  // A self-contained vanilla-JS widget that renders + submits this form. Served
  // at GET /forms/:id/embed.js so it can be dropped on ANY page/popup with a
  // single <script> tag (it mounts in place, or into a [data-lms-form] holder).
  buildEmbedScript(id: string, apiBase: string): string {
    const API = JSON.stringify(apiBase);
    const FID = JSON.stringify(id);
    return `(function(){
var API=${API},FID=${FID};
var s=document.currentScript;
function el(t,a,x){var e=document.createElement(t);if(a)for(var k in a)e.setAttribute(k,a[k]);if(x!=null)e.textContent=x;return e;}
var holder=document.querySelector('[data-lms-form="'+FID+'"]');
var mount;
if(holder){mount=holder;}
else if(s&&s.parentNode){mount=el('div');s.parentNode.insertBefore(mount,s.nextSibling);}
else{mount=el('div');document.body.appendChild(mount);}
fetch(API+'/forms/'+FID).then(function(r){if(!r.ok)throw 0;return r.json();}).then(render).catch(function(){});
function render(def){
var f=el('form');f.style.cssText='display:flex;flex-direction:column;gap:14px;max-width:480px;font-family:inherit';
var inputs={};
(def.fields||[]).forEach(function(fl){
var w=el('div');w.style.cssText='display:flex;flex-direction:column;gap:6px';var inp;
if(fl.type==='textarea'){inp=el('textarea');}
else if(fl.type==='select'){inp=el('select');inp.appendChild(el('option',{value:''},fl.placeholder||'Select…'));(fl.options||[]).forEach(function(o){inp.appendChild(el('option',{value:o},o));});}
else if(fl.type==='checkbox'){inp=el('input',{type:'checkbox'});}
else{inp=el('input',{type:fl.type==='email'?'email':fl.type==='phone'?'tel':fl.type==='number'?'number':'text'});}
if(fl.placeholder&&fl.type!=='select')inp.setAttribute('placeholder',fl.placeholder);
if(fl.required&&fl.type!=='checkbox')inp.required=true;
if(fl.type==='checkbox'){var cl=el('label');cl.style.cssText='display:flex;gap:8px;align-items:center;font-size:14px';cl.appendChild(inp);cl.appendChild(document.createTextNode(' '+fl.label+(fl.required?' *':'')));w.appendChild(cl);}
else{var lb=el('label',null,fl.label+(fl.required?' *':''));lb.style.cssText='font-weight:600;font-size:14px';inp.style.cssText='padding:10px 12px;border-radius:8px;border:1px solid #d1d5db;font:inherit;width:100%';w.appendChild(lb);w.appendChild(inp);}
inputs[fl.name]=inp;f.appendChild(w);
});
var er=el('div');er.style.cssText='color:#dc2626;font-size:14px;display:none';f.appendChild(er);
var b=el('button',{type:'submit'},'Submit');b.style.cssText='padding:12px 22px;border-radius:999px;border:none;background:#6d28d9;color:#fff;font-weight:600;cursor:pointer;align-self:flex-start';f.appendChild(b);
f.addEventListener('submit',function(ev){ev.preventDefault();er.style.display='none';
var vals={};(def.fields||[]).forEach(function(fl){vals[fl.name]=fl.type==='checkbox'?inputs[fl.name].checked:inputs[fl.name].value;});
b.disabled=true;b.textContent='Submitting…';
fetch(API+'/forms/'+FID+'/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({values:vals})})
.then(function(r){return r.json().then(function(d){return{ok:r.ok,d:d};});})
.then(function(x){if(!x.ok){throw new Error((x.d&&x.d.message)||'Submit failed');}if(x.d.redirectUrl){window.location.href=x.d.redirectUrl;return;}mount.innerHTML='';var ok=el('div',null,x.d.message||"Thanks! You're subscribed.");ok.style.cssText='padding:16px;border-radius:10px;background:#dcfce7;color:#166534';mount.appendChild(ok);})
.catch(function(e){er.textContent=e.message||'Something went wrong.';er.style.display='block';b.disabled=false;b.textContent='Submit';});
});
mount.appendChild(f);
}
})();`;
  }

  // ---------- admin CRUD ----------

  async adminList(): Promise<FormAdminRow[]> {
    const forms = await this.prisma.form.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        audience: { select: { name: true } },
        _count: { select: { submissions: true } },
      },
    });
    return forms.map((f: FormRow) => this.toAdminRow(f));
  }

  async adminGet(id: string): Promise<FormAdminRow> {
    const form = await this.prisma.form.findUnique({
      where: { id },
      include: {
        audience: { select: { name: true } },
        _count: { select: { submissions: true } },
      },
    });
    if (!form) throw new NotFoundException('Form not found');
    return this.toAdminRow(form);
  }

  async adminCreate(dto: CreateFormDto): Promise<FormAdminRow> {
    const form = await this.prisma.form.create({
      data: {
        name: dto.name.trim(),
        fields: (dto.fields ?? []) as unknown as Prisma.InputJsonValue,
        audienceId: dto.audienceId ?? null, // null = default "Members" audience
        doubleOptIn: dto.doubleOptIn ?? false, // default: No
        updateExisting: dto.updateExisting ?? true, // default: Yes
        tags: dto.tags ?? [],
        successMessage: dto.successMessage?.trim() || null,
        redirectUrl: dto.redirectUrl?.trim() || null,
        status: dto.status ?? 'ACTIVE',
      },
      include: {
        audience: { select: { name: true } },
        _count: { select: { submissions: true } },
      },
    });
    return this.toAdminRow(form);
  }

  async adminUpdate(id: string, dto: UpdateFormDto): Promise<FormAdminRow> {
    const existing = await this.prisma.form.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Form not found');
    const form = await this.prisma.form.update({
      where: { id },
      data: {
        name: dto.name?.trim() ?? undefined,
        fields:
          dto.fields !== undefined
            ? (dto.fields as unknown as Prisma.InputJsonValue)
            : undefined,
        audienceId:
          dto.audienceId !== undefined ? dto.audienceId || null : undefined,
        doubleOptIn: dto.doubleOptIn ?? undefined,
        updateExisting: dto.updateExisting ?? undefined,
        tags: dto.tags ?? undefined,
        successMessage:
          dto.successMessage !== undefined
            ? dto.successMessage.trim() || null
            : undefined,
        redirectUrl:
          dto.redirectUrl !== undefined
            ? dto.redirectUrl.trim() || null
            : undefined,
        status: dto.status ?? undefined,
      },
      include: {
        audience: { select: { name: true } },
        _count: { select: { submissions: true } },
      },
    });
    return this.toAdminRow(form);
  }

  async adminDelete(id: string): Promise<{ ok: true }> {
    const existing = await this.prisma.form.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Form not found');
    await this.prisma.form.delete({ where: { id } });
    return { ok: true };
  }

  // Stored submissions for the admin entries viewer (latest first, capped).
  async listSubmissions(formId: string): Promise<FormSubmissionDTO[]> {
    const form = await this.prisma.form.findUnique({ where: { id: formId } });
    if (!form) throw new NotFoundException('Form not found');
    const subs = await this.prisma.formSubmission.findMany({
      where: { formId },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
    return subs.map((s) => ({
      id: s.id,
      email: s.email,
      data: (s.data && typeof s.data === 'object' && !Array.isArray(s.data)
        ? s.data
        : {}) as Record<string, string | number | boolean>,
      subscribeStatus: s.subscribeStatus,
      createdAt: s.createdAt.toISOString(),
    }));
  }

  // ---------- public ----------

  async getPublic(id: string): Promise<FormPublicDTO> {
    const form = await this.prisma.form.findUnique({ where: { id } });
    if (!form || form.status !== 'ACTIVE') {
      throw new NotFoundException('Form not found');
    }
    return {
      id: form.id,
      name: form.name,
      fields: this.asFields(form.fields),
      successMessage: form.successMessage,
      redirectUrl: form.redirectUrl,
    };
  }

  async submit(
    id: string,
    values: Record<string, unknown>,
  ): Promise<FormSubmitResult> {
    const form = await this.prisma.form.findUnique({ where: { id } });
    if (!form || form.status !== 'ACTIVE') {
      throw new NotFoundException('Form not found');
    }
    const fields = this.asFields(form.fields);
    const safeValues =
      values && typeof values === 'object' ? values : ({} as Record<string, unknown>);

    // Server-side validation (never trust the client).
    for (const f of fields) {
      const v = safeValues[f.name];
      const empty =
        v === undefined ||
        v === null ||
        v === '' ||
        (f.type === 'checkbox' && v !== true);
      if (f.required && empty) {
        throw new BadRequestException(`"${f.label}" is required`);
      }
    }

    const emailField =
      fields.find((f) => f.mergeTag === 'EMAIL') ??
      fields.find((f) => f.type === 'email');
    const email =
      emailField && typeof safeValues[emailField.name] === 'string'
        ? (safeValues[emailField.name] as string).trim()
        : '';
    if (email && !EMAIL_RE.test(email)) {
      throw new BadRequestException('Please enter a valid email address');
    }

    // Store the submission first so a contacts hiccup never loses the lead.
    const submission = await this.prisma.formSubmission.create({
      data: {
        formId: form.id,
        email: email || null,
        data: safeValues as unknown as Prisma.InputJsonValue,
      },
    });

    // Map mapped fields -> in-house contact attributes (EMAIL is the address
    // itself, so it's excluded here).
    const mergeFields: Record<string, unknown> = {};
    for (const f of fields) {
      if (f.mergeTag && f.mergeTag !== 'EMAIL') {
        const v = safeValues[f.name];
        if (v !== undefined && v !== null && v !== '') {
          mergeFields[f.mergeTag] =
            typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v;
        }
      }
    }

    // In-house list write. Fires whenever there's an email — NOT gated on a
    // configured audience: a null form.audienceId resolves to the default
    // "Members" audience, so a form with no audience still captures everyone.
    // Best-effort so a contacts hiccup never 500s the public submit.
    let subscribeStatus: string;
    if (!email) {
      subscribeStatus = 'skipped';
    } else {
      try {
        subscribeStatus = await this.contacts.subscribe(
          // null (no configured audience) → default "Members" audience.
          form.audienceId ?? null,
          email,
          mergeFields,
          {
            doubleOptIn: form.doubleOptIn,
            updateExisting: form.updateExisting,
            tags: form.tags,
            source: 'FORM',
          },
        );
      } catch (e) {
        subscribeStatus = 'failed';
        this.logger.warn(
          `Contacts subscribe failed for form ${form.id}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }

    await this.prisma.formSubmission.update({
      where: { id: submission.id },
      data: { subscribeStatus },
    });

    return {
      ok: true,
      subscribeStatus,
      redirectUrl: form.redirectUrl,
      message: form.successMessage,
    };
  }

  // ---------- mappers ----------

  private asFields(value: Prisma.JsonValue): FormFieldDef[] {
    return Array.isArray(value) ? (value as unknown as FormFieldDef[]) : [];
  }

  private toAdminRow(f: FormRow): FormAdminRow {
    return {
      id: f.id,
      name: f.name,
      fields: this.asFields(f.fields),
      audienceId: f.audienceId,
      audienceName: f.audience?.name ?? null, // null = default "Members"
      doubleOptIn: f.doubleOptIn,
      updateExisting: f.updateExisting,
      tags: f.tags,
      successMessage: f.successMessage,
      redirectUrl: f.redirectUrl,
      status: f.status,
      submissionCount: f._count?.submissions ?? 0,
      createdAt: f.createdAt.toISOString(),
      updatedAt: f.updatedAt.toISOString(),
    };
  }
}
