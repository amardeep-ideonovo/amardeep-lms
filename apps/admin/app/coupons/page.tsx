"use client";

import { FormEvent, useEffect, useState } from "react";
import type { CouponDTO, CreateCouponInput, LevelDTO } from "@lms/types";
import { ApiError, api } from "@/lib/api";
import { useAdminAuth } from "@/components/AdminAuthProvider";
import { dialog } from "@/components/DialogProvider";

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
  const amt = (c.amountOff ?? 0) / 100;
  return `${amt.toLocaleString(undefined, {
    style: "currency",
    currency: (c.currency || "usd").toUpperCase(),
  })} off`;
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
  const [coupons, setCoupons] = useState<CouponDTO[]>([]);
  const [levels, setLevels] = useState<LevelDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [c, l] = await Promise.all([api.listCoupons(), api.listLevels()]);
      setCoupons(c);
      setLevels(l);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load coupons");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authLoading || !can("coupons", "read")) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading]);

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
          duration === "repeating" ? Math.round(Number(durationInMonths)) : undefined,
        maxRedemptions: maxRedemptions ? Math.round(Number(maxRedemptions)) : undefined,
        expiresAt: expiresAt || undefined,
        levelId: levelId || undefined,
      };
      await api.createCoupon(input);
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn’t create coupon");
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
      if (turningOff) await api.deactivateCoupon(c.id);
      else await api.activateCoupon(c.id);
      await load();
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
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Delete failed");
    } finally {
      setBusyId(null);
    }
  }

  const visible = coupons.filter((c) =>
    filter === "all" ? true : filter === "active" ? c.active : !c.active,
  );

  if (authLoading) return <p className="muted">Loading…</p>;
  if (!can("coupons", "read"))
    return (
      <div>
        <div className="page-header">
          <h1>Coupons</h1>
        </div>
        <p className="muted">You don’t have permission to view this.</p>
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
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => setCode(randomCode())}
                >
                  Generate
                </button>
              </div>
            </div>
            <div className="field">
              <label>Discount type</label>
              <select
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value as DiscountType)}
              >
                <option value="percent">Percent off</option>
                <option value="amount">Fixed amount off</option>
              </select>
            </div>
            <div className="field">
              <label>{discountType === "percent" ? "Percent (1–100)" : "Amount"}</label>
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
            <select value={levelId} onChange={(e) => setLevelId(e.target.value)}>
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

          {error && <p className="error">{error}</p>}
          <div className="row-actions">
            <button className="btn" type="submit" disabled={saving}>
              {saving ? "Creating…" : "Create coupon"}
            </button>
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
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="all">All</option>
            </select>
            <span className="muted" style={{ fontSize: 13 }}>
              Showing {visible.length} of {coupons.length}
            </span>
          </div>
        )}
        {loading ? (
          <p className="muted">Loading…</p>
        ) : coupons.length === 0 ? (
          <p className="muted">No coupons yet.</p>
        ) : visible.length === 0 ? (
          <p className="muted">No {filter} coupons.</p>
        ) : (
          <div className="table-wrap"><table className="table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Discount</th>
                <th>Applies to</th>
                <th>Redemptions</th>
                <th>Class</th>
                <th>Status</th>
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
                          <button
                            className="btn btn--ghost btn--sm"
                            disabled={busyId === c.id}
                            onClick={() => toggleActive(c)}
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button
                            className="btn btn--ghost btn--sm"
                            disabled={busyId === c.id || status === "Expired"}
                            onClick={() => toggleActive(c)}
                          >
                            Activate
                          </button>
                        )}
                        <button
                          className="btn btn--danger btn--sm"
                          disabled={busyId === c.id}
                          onClick={() => removeCoupon(c)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
