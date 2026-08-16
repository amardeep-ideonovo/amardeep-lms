"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  ADMIN_ACTIONS,
  ADMIN_SECTIONS,
  type AdminAction,
  type AdminDTO,
  type AdminPermissions,
  type AdminSection,
} from "@lms/types";
import { ApiError, api } from "@/lib/api";
import { useModalA11y } from "@/lib/useModalA11y";
import { dialog } from "@/components/DialogProvider";
import { useAdminAuth } from "@/components/AdminAuthProvider";
import { PASSWORD_MIN, STR } from "@lms/types";
import { Button } from "@lms/ui";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

const isReadOnly = (s: (typeof ADMIN_SECTIONS)[number]) =>
  (s as { readOnly?: boolean }).readOnly === true;

function PermsSummary({ perms }: { perms: AdminPermissions }) {
  const parts: string[] = [];
  for (const s of ADMIN_SECTIONS) {
    const a = perms[s.key];
    if (!a) continue;
    const granted = ADMIN_ACTIONS.filter((act) => a[act]).map((act) => act[0]);
    if (granted.length) parts.push(`${s.label} (${granted.join("")})`);
  }
  if (!parts.length) return <span className="muted">No access</span>;
  return <span style={{ fontSize: 12 }}>{parts.join(" · ")}</span>;
}

type Modal = { mode: "create" } | { mode: "edit"; admin: AdminDTO } | null;

export default function AdminsPage() {
  const { me, isSuperAdmin, loading: authLoading } = useAdminAuth();
  const [admins, setAdmins] = useState<AdminDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAdmins(await api.listAdmins());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load admins");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isSuperAdmin) void load();
  }, [isSuperAdmin, load]);

  if (authLoading) return <p className="muted">{STR.common.loading}</p>;
  if (!isSuperAdmin) {
    return (
      <div>
        <div className="page-header">
          <h1>Admins</h1>
        </div>
        <p className="error">You don’t have access to admin management.</p>
      </div>
    );
  }

  async function onDelete(a: AdminDTO) {
    if (a.id === me?.id) return;
    if (
      !(await dialog.confirm({
        message: STR.confirm.deleteEntity("admin", a.email),
        danger: true,
      }))
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteAdmin(a.id);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function onResetPassword(a: AdminDTO) {
    const pw = await dialog.prompt({
      title: "Reset password",
      message: `New password for ${a.email} (min ${PASSWORD_MIN.admin} chars):`,
      inputType: "password",
    });
    if (pw === null) return;
    if (pw.length < PASSWORD_MIN.admin) {
      setError(STR.validation.passwordMin(PASSWORD_MIN.admin));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.resetAdminPassword(a.id, pw);
      await dialog.notify("Password updated.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Reset failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-header with-action">
        <div>
          <h1>Admins</h1>
          <p className="subtitle">
            Create admins and control which sections each one can access (create
            / read / edit / delete). Only super admins can manage admins.
          </p>
        </div>
        <Button onClick={() => setModal({ mode: "create" })}>
          + Add admin
        </Button>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="card">
        {loading ? (
          <p className="muted">{STR.common.loading}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{STR.labels.email}</th>
                  <th>Role</th>
                  <th>Access</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {admins.map((a) => (
                  <tr key={a.id}>
                    <td>
                      {a.email}
                      {a.id === me?.id ? (
                        <span className="muted"> (you)</span>
                      ) : null}
                    </td>
                    <td>
                      {a.role === "SUPER_ADMIN" ? (
                        <span className="badge">Super admin</span>
                      ) : (
                        "Admin"
                      )}
                    </td>
                    <td>
                      {a.role === "SUPER_ADMIN" ? (
                        <span className="muted">Full access</span>
                      ) : (
                        <PermsSummary perms={a.permissions} />
                      )}
                    </td>
                    <td className="muted">{fmtDate(a.createdAt)}</td>
                    <td>
                      <div className="row-actions">
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busy}
                          onClick={() => setModal({ mode: "edit", admin: a })}
                        >
                          {STR.common.edit}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busy}
                          onClick={() => onResetPassword(a)}
                        >
                          Reset password
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={busy || a.id === me?.id}
                          onClick={() => onDelete(a)}
                        >
                          {STR.common.delete}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal && (
        <AdminModal
          mode={modal.mode}
          admin={modal.mode === "edit" ? modal.admin : null}
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function AdminModal({
  mode,
  admin,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  admin: AdminDTO | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [email, setEmail] = useState(admin?.email ?? "");
  const [password, setPassword] = useState("");
  const [superAdmin, setSuperAdmin] = useState(admin?.role === "SUPER_ADMIN");
  const [perms, setPerms] = useState<AdminPermissions>(
    admin?.permissions ?? {},
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const modalRef = useModalA11y();

  const toggle = (section: AdminSection, action: AdminAction) => {
    setPerms((prev) => {
      const cur = { ...(prev[section] ?? {}) };
      if (cur[action]) delete cur[action];
      else cur[action] = true;
      const next = { ...prev };
      if (Object.keys(cur).length) next[section] = cur;
      else delete next[section];
      return next;
    });
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (mode === "create") {
      if (!email.trim()) {
        setErr("Email is required");
        return;
      }
      if (password.length < PASSWORD_MIN.admin) {
        setErr(STR.validation.passwordMin(PASSWORD_MIN.admin));
        return;
      }
    }
    setBusy(true);
    try {
      if (mode === "create") {
        await api.createAdmin({
          email: email.trim(),
          password,
          superAdmin,
          permissions: superAdmin ? {} : perms,
        });
      } else if (admin) {
        await api.updateAdmin(admin.id, {
          superAdmin,
          permissions: superAdmin ? {} : perms,
        });
      }
      await onSaved();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "Save failed");
      setBusy(false);
    }
  }

  // Not dismissable by accident (backdrop/Escape) — use ×/Cancel/Save.
  return (
    <div
      ref={modalRef}
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
    >
      <div className="modal" style={{ maxWidth: 660 }}>
        <div className="modal-header">
          <h2>{mode === "create" ? "Add admin" : `Edit ${admin?.email}`}</h2>
          <button
            type="button"
            className="modal-close"
            aria-label={STR.common.close}
            disabled={busy}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="modal-body">
          {err && <p className="error">{err}</p>}
          <form onSubmit={submit}>
            {mode === "create" && (
              <>
                <div className="field">
                  <label htmlFor="adm-email">{STR.labels.email}</label>
                  <input
                    id="adm-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="adm-pw">Temporary password</label>
                  <input
                    id="adm-pw"
                    type="text"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={8}
                    required
                  />
                  <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    Share this with the new admin; they can change it after
                    signing in.
                  </p>
                </div>
              </>
            )}

            <label
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                margin: "10px 0",
              }}
            >
              <input
                type="checkbox"
                checked={superAdmin}
                onChange={(e) => setSuperAdmin(e.target.checked)}
              />
              <span>
                <strong>Full access (super admin)</strong> — manages everything,
                including other admins
              </span>
            </label>

            {!superAdmin && (
              <div className="table-wrap">
                <table className="table perms-matrix">
                  <thead>
                    <tr>
                      <th>Section</th>
                      {ADMIN_ACTIONS.map((a) => (
                        <th key={a} style={{ textTransform: "capitalize" }}>
                          {a}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ADMIN_SECTIONS.map((s) => (
                      <tr key={s.key}>
                        <td>
                          {s.label}
                          {isReadOnly(s) ? (
                            <span className="muted"> (read-only)</span>
                          ) : null}
                        </td>
                        {ADMIN_ACTIONS.map((a) => {
                          const disabled = isReadOnly(s) && a !== "read";
                          return (
                            <td key={a} style={{ textAlign: "center" }}>
                              {disabled ? (
                                <span className="muted">—</span>
                              ) : (
                                <input
                                  type="checkbox"
                                  checked={perms[s.key]?.[a] === true}
                                  onChange={() => toggle(s.key, a)}
                                />
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="row-actions" style={{ marginTop: 16 }}>
              <Button type="submit" disabled={busy}>
                {busy
                  ? STR.common.saving
                  : mode === "create"
                    ? "Create admin"
                    : "Save changes"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={onClose}
                disabled={busy}
              >
                {STR.common.cancel}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
