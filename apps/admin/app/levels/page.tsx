"use client";

import { FormEvent, useEffect, useState } from "react";
import type {
  CreateLevelInput,
  LevelDTO,
  LevelType,
  MailchimpAudienceDTO,
} from "@lms/types";
import { ApiError, api } from "@/lib/api";

type PriceForm = { interval: "month" | "year"; amount: string };

const LEVEL_TYPES: LevelType[] = ["PAID", "FREE", "MANUAL"];

function emptyPrice(): PriceForm {
  return { interval: "month", amount: "" };
}

export default function LevelsPage() {
  const [levels, setLevels] = useState<LevelDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // create/edit form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [type, setType] = useState<LevelType>("PAID");
  const [mailchimpTags, setMailchimpTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [mailchimpAudienceId, setMailchimpAudienceId] = useState("");
  const [mailchimpAudienceName, setMailchimpAudienceName] = useState("");
  const [prices, setPrices] = useState<PriceForm[]>([emptyPrice()]);
  const [saving, setSaving] = useState(false);
  // Create/edit happen in a modal (opened by the top button or a row's Edit).
  const [modalOpen, setModalOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Live Mailchimp audiences for the dropdown (empty if Mailchimp unconfigured).
  const [audiences, setAudiences] = useState<MailchimpAudienceDTO[]>([]);
  const [mcError, setMcError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setLevels(await api.listLevels());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load levels");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Close the modal on Escape (mirrors the courses modal).
  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen]);

  // Fetch Mailchimp audiences once. If Mailchimp isn't configured the API
  // returns 400 — surface a hint but keep the page usable (audience optional).
  useEffect(() => {
    let alive = true;
    api
      .listMailchimpAudiences()
      .then((a) => alive && setAudiences(a))
      .catch((err) => {
        if (!alive) return;
        setMcError(
          err instanceof ApiError
            ? err.message
            : "Could not load Mailchimp audiences"
        );
      });
    return () => {
      alive = false;
    };
  }, []);

  function resetForm() {
    setEditingId(null);
    setName("");
    setSlug("");
    setType("PAID");
    setMailchimpTags([]);
    setTagInput("");
    setMailchimpAudienceId("");
    setMailchimpAudienceName("");
    setPrices([emptyPrice()]);
    setFormError(null);
  }
  function openCreate() {
    resetForm();
    setModalOpen(true);
  }
  function closeModal() {
    setModalOpen(false);
    resetForm();
  }

  function startEdit(level: LevelDTO) {
    setEditingId(level.id);
    setName(level.name);
    setSlug(level.slug ?? "");
    setType(level.type);
    setMailchimpTags(level.mailchimpTags ?? []);
    setTagInput("");
    setMailchimpAudienceId(level.mailchimpAudienceId ?? "");
    setMailchimpAudienceName(level.mailchimpAudienceName ?? "");
    setPrices(
      level.prices.length
        ? level.prices.map((p) => ({
            interval: p.interval,
            amount: (p.amount / 100).toString(),
          }))
        : [emptyPrice()]
    );
    setFormError(null);
    setModalOpen(true);
  }

  function addTag() {
    const t = tagInput.trim();
    if (t && !mailchimpTags.includes(t)) setMailchimpTags((p) => [...p, t]);
    setTagInput("");
  }
  function removeTag(t: string) {
    setMailchimpTags((p) => p.filter((x) => x !== t));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const cleanedPrices = prices
        .filter((p) => p.amount.trim() !== "")
        .map((p) => ({
          interval: p.interval,
          amount: Math.round(parseFloat(p.amount) * 100), // dollars -> cents
        }));
      // Flush any tag still typed in the box but not yet added.
      const pending = tagInput.trim();
      const finalTags =
        pending && !mailchimpTags.includes(pending)
          ? [...mailchimpTags, pending]
          : mailchimpTags;
      const input: CreateLevelInput = {
        name: name.trim(),
        slug: slug.trim(),
        type,
        mailchimpTags: finalTags,
        mailchimpAudienceId: mailchimpAudienceId || undefined,
        mailchimpAudienceName: mailchimpAudienceName || undefined,
        prices: type === "PAID" ? cleanedPrices : [],
      };
      if (editingId) await api.updateLevel(editingId, input);
      else await api.createLevel(input);
      setModalOpen(false);
      resetForm();
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(id: string) {
    if (!window.confirm("Delete this level?")) return;
    try {
      await api.deleteLevel(id);
      if (editingId === id) resetForm();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Delete failed");
    }
  }

  function updatePrice(i: number, patch: Partial<PriceForm>) {
    setPrices((prev) =>
      prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p))
    );
  }

  return (
    <div>
      <div className="page-header with-action">
        <div>
          <h1>Levels</h1>
          <p className="subtitle">
            Membership tiers. Each level can subscribe members to a Mailchimp
            audience (and apply a tag within it), and — if PAID — has Stripe
            prices.
          </p>
        </div>
        <button className="btn" onClick={openCreate}>
          + Add new level
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {modalOpen && (
        <div
          className="modal-overlay"
          onClick={closeModal}
          role="dialog"
          aria-modal="true"
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingId ? "Edit level" : "Create level"}</h2>
              <button
                type="button"
                className="modal-close"
                onClick={closeModal}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              {formError && <p className="error">{formError}</p>}
              <form onSubmit={onSubmit}>
          <div className="form-row">
            <div className="field">
              <label>Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label>Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as LevelType)}
              >
                {LEVEL_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Mailchimp tags</label>
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTag();
                  }
                }}
                onBlur={addTag}
                placeholder="Type a tag, press Enter"
              />
              {mailchimpTags.length > 0 && (
                <div className="chips" style={{ marginTop: 8 }}>
                  {mailchimpTags.map((t) => (
                    <span key={t} className="chip chip--muted">
                      {t}
                      <button
                        type="button"
                        className="chip-x"
                        aria-label={`Remove ${t}`}
                        title={`Remove ${t}`}
                        onClick={() => removeTag(t)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="field">
            <label>
              Checkout URL slug <span className="muted">(optional)</span>
            </label>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="e.g. pro"
            />
            <span className="muted" style={{ fontSize: 12 }}>
              {slug.trim()
                ? `Checkout URL: /checkout/${slug.trim()}`
                : "Leave blank to use the raw level id in the checkout URL."}
            </span>
          </div>

          <div className="field">
            <label>
              Mailchimp audience{" "}
              <span className="muted">
                (members granted this level subscribe here; the tag is applied
                within it)
              </span>
            </label>
            <select
              value={mailchimpAudienceId}
              onChange={(e) => {
                const id = e.target.value;
                const aud = audiences.find((a) => a.id === id);
                setMailchimpAudienceId(id);
                // keep the cached name in sync with the selection
                setMailchimpAudienceName(
                  aud ? aud.name : id ? mailchimpAudienceName : ""
                );
              }}
            >
              <option value="">— None (use the global audience) —</option>
              {/* keep the stored audience selectable even if it isn't in the
                  fetched list (e.g. Mailchimp unconfigured or list removed) */}
              {mailchimpAudienceId &&
                !audiences.some((a) => a.id === mailchimpAudienceId) && (
                  <option value={mailchimpAudienceId}>
                    {mailchimpAudienceName || mailchimpAudienceId}
                  </option>
                )}
              {audiences.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {typeof a.memberCount === "number"
                    ? ` (${a.memberCount})`
                    : ""}
                </option>
              ))}
            </select>
            {mcError && (
              <span className="muted" style={{ fontSize: 12 }}>
                {mcError} — set the key in Settings → Mailchimp to pick a list.
              </span>
            )}
          </div>

          {type === "PAID" && (
            <div className="field">
              <label>Prices</label>
              {prices.map((p, i) => (
                <div className="form-row" key={i} style={{ marginBottom: 8 }}>
                  <select
                    value={p.interval}
                    onChange={(e) =>
                      updatePrice(i, {
                        interval: e.target.value as "month" | "year",
                      })
                    }
                  >
                    <option value="month">Monthly</option>
                    <option value="year">Yearly</option>
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Amount (USD)"
                    value={p.amount}
                    onChange={(e) => updatePrice(i, { amount: e.target.value })}
                  />
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() =>
                      setPrices((prev) =>
                        prev.length > 1
                          ? prev.filter((_, idx) => idx !== i)
                          : prev
                      )
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setPrices((prev) => [...prev, emptyPrice()])}
              >
                + Add price
              </button>
            </div>
          )}

                <div className="row-actions">
                  <button className="btn" type="submit" disabled={saving}>
                    {saving
                      ? "Saving…"
                      : editingId
                        ? "Update level"
                        : "Create level"}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={closeModal}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h2>All levels</h2>
          <button className="btn btn--sm" onClick={openCreate}>
            + Add new level
          </button>
        </div>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : levels.length === 0 ? (
          <p className="muted">No levels yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Members</th>
                <th>Prices</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {levels.map((lvl) => (
                <tr key={lvl.id}>
                  <td>{lvl.name}</td>
                  <td>{lvl.type}</td>
                  <td>{lvl.memberCount}</td>
                  <td>
                    {lvl.prices.length === 0 ? (
                      <span className="muted">—</span>
                    ) : (
                      <div className="chips">
                        {lvl.prices.map((p) => (
                          <span key={p.id} className="chip chip--muted">
                            {(p.amount / 100).toLocaleString(undefined, {
                              style: "currency",
                              currency: p.currency || "USD",
                            })}
                            /{p.interval}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() => startEdit(lvl)}
                      >
                        Edit
                      </button>
                      <button
                        className="btn btn--danger btn--sm"
                        onClick={() => onDelete(lvl.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
