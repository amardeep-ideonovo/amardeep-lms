"use client";

import { FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CouponDTO, CreateCouponInput } from "@lms/types";
import { ApiError, api } from "@/lib/api";
import { qk } from "@/lib/queries";
import { useAdminAuth } from "@/components/AdminAuthProvider";
import { dialog } from "@/components/DialogProvider";
import { usePersistedDraft } from "@/lib/usePersistedDraft";
import DraftRestoredBanner from "@/components/DraftRestoredBanner";
import { STR, formatMoney } from "@lms/types";
import { Button } from "@lms/ui";

type DiscountType = "percent" | "amount";
type Duration = "once" | "repeating" | "forever";

function randomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let out = "";
  for (let i = 0; i < 8; i++)
    out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function discountLabel(c: CouponDTO): string {
  if (c.discountType === "percent") return `${c.percentOff}% off`;
  return `${formatMoney(c.amountOff ?? 0, c.currency || "usd")} off`;
}

function durationLabel(c: CouponDTO): string {
  if (c.duration === "once") return "First payment";
  if (c.duration === "forever") return "Every payment";
  return `${c.durationInMonths ?? "?"} months`;
}

function statusOf(c: CouponDTO): "Active" | "Inactive" | "Expired" {
  if (!c.active) return "Inactive";
  if (c.expiresAt && new Date(c.expiresAt).getTime() < Date.now())
    return "Expired";
  return "Active";
}

export default function CouponsPage() {
  const { can, loading: authLoading } = useAdminAuth();
  const queryClient = useQueryClient();
  // The list reads live in the query cache (docs/coding-standards.md D4).
  // `enabled` keeps the RBAC gate: a denied section never fires the request.
  const canRead = !authLoading && can("coupons", "read");
  const couponsQuery = useQuery({
    queryKey: qk.coupons,
    queryFn: () => api.listCoupons(),
    enabled: canRead,
  });
  const levelsQuery = useQuery({
    queryKey: qk.levels,
    queryFn: () => api.listLevels(),
    enabled: canRead,
  });
  const coupons = couponsQuery.data ?? [];
  const levels = levelsQuery.data ?? [];
  const loading = couponsQuery.isPending || levelsQuery.isPending;
  const [error, setError] = useState<string | null>(null); // mutation errors
  const [busyId, setBusyId] = useState<string | null>(null);
  // Load failures surface from the queries, mutation failures from `error`;
  // one slot renders both (a mutation's message wins while set, as before).
  const loadFailure = couponsQuery.error ?? levelsQuery.error;
  const pageError =
    error ??
    (loadFailure
      ? loadFailure instanceof ApiError
        ? loadFailure.message
        : "Failed to load coupons"
      : null);

  // create form
  const [code, setCode] = useState("");
  const [discountType, setDiscountType] = useState<DiscountType>("percent");
  const [value, setValue] = useState("");
  const [currency, setCurrency] = useState("usd");
  const [duration, setDuration] = useState<Duration>("once");
  const [durationInMonths, setDurationInMonths] = useState("");
  const [maxRedemptions, setMaxRedemptions] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [levelId, setLevelId] = useState("");
  const [saving, setSaving] = useState(false);
  // Promotion codes are permanent in Stripe (deactivate, never delete), so the
  // list accumulates. Default to showing only active codes.
  const [filter, setFilter] = useState<"active" | "inactive" | "all">("active");

  function resetForm() {
    setCode("");
    setDiscountType("percent");
    setValue("");
    setCurrency("usd");
    setDuration("once");
    setDurationInMonths("");
    setMaxRedemptions("");
    setExpiresAt("");
    setLevelId("");
  }

  // Persist the half-filled "Create coupon" form so it survives a reload / tab
  // switch. Create-only (no edit), so entityId is null; `open` follows the RBAC
  // gate so it never arms before auth resolves or without permission.
  const draft = usePersistedDraft({
    formKey: "coupons",
    version: 1,
    entityId: null,
    open: canRead,
    data: {
      code,
      discountType,
      value,
      currency,
      duration,
      durationInMonths,
      maxRedemptions,
      expiresAt,
      levelId,
    },
    restore: (d) => {
      setCode(d.code);
      setDiscountType(d.discountType);
      setValue(d.value);
      setCurrency(d.currency);
      setDuration(d.duration);
      setDurationInMonths(d.durationInMonths);
      setMaxRedemptions(d.maxRedemptions);
      setExpiresAt(d.expiresAt);
      setLevelId(d.levelId);
    },
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const input: CreateCouponInput = {
        code: code.trim(),
        discountType,
        duration,
        percentOff:
          discountType === "percent" ? Math.round(Number(value)) : undefined,
        amountOff:
          discountType === "amount"
            ? Math.round(parseFloat(value) * 100) // dollars -> cents
            : undefined,
        currency: discountType === "amount" ? currency || "usd" : undefined,
        durationInMonths:
          duration === "repeating"
            ? Math.round(Number(durationInMonths))
            : undefined,
        maxRedemptions: maxRedemptions
          ? Math.round(Number(maxRedemptions))
          : undefined,
        expiresAt: expiresAt || undefined,
        levelId: levelId || undefined,
      };
      // The response is the full CouponDTO the list renders (same toDTO mapper).
      // Stripe lists promotion codes newest-first, so the new code goes on top.
      // Levels are untouched by a coupon create, so they need no refresh.
      const created = await api.createCoupon(input);
      draft.clearSaved(); // created successfully → drop the persisted draft
      resetForm();
      queryClient.setQueryData<CouponDTO[]>(qk.coupons, (prev = []) => [
        created,
        ...prev,
      ]);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Couldn’t create coupon",
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(c: CouponDTO) {
    const turningOff = c.active;
    if (turningOff && !(await dialog.confirm(`Deactivate code ${c.code}?`)))
      return;
    setBusyId(c.id);
    setError(null);
    try {
      // Both return the updated CouponDTO; the list order is Stripe's creation
      // order, which a status flip doesn't change.
      const updated = turningOff
        ? await api.deactivateCoupon(c.id)
        : await api.activateCoupon(c.id);
      queryClient.setQueryData<CouponDTO[]>(qk.coupons, (prev) =>
        prev?.map((row) => (row.id === updated.id ? updated : row)),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setBusyId(null);
    }
  }

  async function removeCoupon(c: CouponDTO) {
    if (
      !(await dialog.confirm({
        message: `Permanently delete code ${c.code}? It can no longer be redeemed and this can’t be undone.`,
        danger: true,
      }))
    )
      return;
    setBusyId(c.id);
    setError(null);
    try {
      await api.deleteCoupon(c.id);
      // Soft-delete in Stripe (metadata flag + deactivate), but list() filters
      // those out — so the row is gone from the server's list either way.
      queryClient.setQueryData<CouponDTO[]>(qk.coupons, (prev) =>
        prev?.filter((row) => row.id !== c.id),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Delete failed");
    } finally {
      setBusyId(null);
    }
  }

  const visible = coupons.filter((c) =>
    filter === "all" ? true : filter === "active" ? c.active : !c.active,
  );

  if (authLoading) return <p className="muted">{STR.common.loading}</p>;
  if (!can("coupons", "read"))
    return (
      <div>
        <div className="page-header">
          <h1>Coupons</h1>
        </div>
        <p className="muted">{STR.errors.permissionDenied}</p>
      </div>
    );

  return (
    <div>
      <div className="page-header">
        <h1>Coupons</h1>
        <p className="subtitle">
          Generate discount codes for checkout. Codes live in Stripe; redemption
          counts and status are read live. Stripe coupons are immutable — to
          change a discount, deactivate the code and create a new one.
        </p>
      </div>

      <div className="card">
        <h2>Create coupon</h2>
        <form onSubmit={onSubmit}>
          <div className="form-row">
            <div className="field">
              <label>Code</label>
              <div className="row-actions">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="SAVE20"
                  required
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setCode(randomCode())}
                >
                  Generate
                </Button>
              </div>
            </div>
            <div className="field">
              <label>Discount type</label>
              <select
                value={discountType}
                onChange={(e) =>
                  setDiscountType(e.target.value as DiscountType)
                }
              >
                <option value="percent">Percent off</option>
                <option value="amount">Fixed amount off</option>
              </select>
            </div>
            <div className="field">
              <label>
                {discountType === "percent" ? "Percent (1–100)" : "Amount"}
              </label>
              <input
                type="number"
                min={discountType === "percent" ? "1" : "0"}
                max={discountType === "percent" ? "100" : undefined}
                step={discountType === "percent" ? "1" : "0.01"}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={discountType === "percent" ? "20" : "5.00"}
                required
              />
            </div>
            {discountType === "amount" && (
              <div className="field">
                <label>Currency</label>
                <input
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toLowerCase())}
                  placeholder="usd"
                />
              </div>
            )}
          </div>

          <div className="form-row">
            <div className="field">
              <label>Applies to</label>
              <select
                value={duration}
                onChange={(e) => setDuration(e.target.value as Duration)}
              >
                <option value="once">First payment only</option>
                <option value="repeating">First N months</option>
                <option value="forever">Every payment</option>
              </select>
            </div>
            {duration === "repeating" && (
              <div className="field">
                <label>Months</label>
                <input
                  type="number"
                  min="1"
                  value={durationInMonths}
                  onChange={(e) => setDurationInMonths(e.target.value)}
                  required
                />
              </div>
            )}
            <div className="field">
              <label>
                Max redemptions <span className="muted">(optional)</span>
              </label>
              <input
                type="number"
                min="1"
                value={maxRedemptions}
                onChange={(e) => setMaxRedemptions(e.target.value)}
                placeholder="Unlimited"
              />
            </div>
            <div className="field">
              <label>
                Expires <span className="muted">(optional)</span>
              </label>
              <input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </div>
          </div>

          <div className="field">
            <label>
              Restrict to class{" "}
              <span className="muted">(optional — default any plan)</span>
            </label>
            <select
              value={levelId}
              onChange={(e) => setLevelId(e.target.value)}
            >
              <option value="">Any plan</option>
              {levels
                .filter((l) => l.type === "PAID")
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
            </select>
          </div>

          {draft.restored && <DraftRestoredBanner onDiscard={draft.discard} />}
          {pageError && <p className="error">{pageError}</p>}
          <div className="row-actions">
            <Button type="submit" disabled={saving}>
              {saving ? "Creating…" : "Create coupon"}
            </Button>
          </div>
        </form>
      </div>

      <div className="card">
        <h2>All coupons</h2>
        {!loading && coupons.length > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              margin: "4px 0 14px",
              flexWrap: "wrap",
            }}
          >
            <label htmlFor="coupon-filter" style={{ fontWeight: 600 }}>
              Show
            </label>
            <select
              id="coupon-filter"
              value={filter}
              onChange={(e) =>
                setFilter(e.target.value as "active" | "inactive" | "all")
              }
            >
              <option value="active">{STR.common.active}</option>
              <option value="inactive">Inactive</option>
              <option value="all">All</option>
            </select>
            <span className="muted" style={{ fontSize: 13 }}>
              Showing {visible.length} of {coupons.length}
            </span>
          </div>
        )}
        {loading ? (
          <p className="muted">{STR.common.loading}</p>
        ) : coupons.length === 0 ? (
          <p className="muted">No coupons yet.</p>
        ) : visible.length === 0 ? (
          <p className="muted">No {filter} coupons.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Discount</th>
                  <th>Applies to</th>
                  <th>Redemptions</th>
                  <th>{STR.labels.class}</th>
                  <th>{STR.labels.status}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => {
                  const status = statusOf(c);
                  return (
                    <tr key={c.id}>
                      <td>
                        <strong>{c.code}</strong>
                      </td>
                      <td>{discountLabel(c)}</td>
                      <td>{durationLabel(c)}</td>
                      <td>
                        {c.timesRedeemed}
                        {c.maxRedemptions ? ` / ${c.maxRedemptions}` : ""}
                      </td>
                      <td>
                        {c.levelName ?? <span className="muted">Any</span>}
                      </td>
                      <td>
                        <span
                          className={`chip${status === "Active" ? "" : " chip--muted"}`}
                        >
                          {status}
                        </span>
                      </td>
                      <td>
                        <div className="row-actions">
                          {c.active ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={busyId === c.id}
                              onClick={() => toggleActive(c)}
                            >
                              Deactivate
                            </Button>
                          ) : (
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={busyId === c.id || status === "Expired"}
                              onClick={() => toggleActive(c)}
                            >
                              Activate
                            </Button>
                          )}
                          <Button
                            variant="danger"
                            size="sm"
                            disabled={busyId === c.id}
                            onClick={() => removeCoupon(c)}
                          >
                            {STR.common.delete}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
