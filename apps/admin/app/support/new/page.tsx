"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  RaiseSupportTicketInput,
  SupportTicketPriority,
  SupportTicketCategory,
} from "@lms/types";
import { ApiError, api } from "@/lib/api";

const PRIORITIES: { value: SupportTicketPriority; label: string }[] = [
  { value: "LOW", label: "Low" },
  { value: "NORMAL", label: "Normal" },
  { value: "HIGH", label: "High" },
  { value: "URGENT", label: "Urgent" },
];

const CATEGORIES: { value: SupportTicketCategory; label: string }[] = [
  { value: "TECHNICAL", label: "Technical" },
  { value: "BILLING", label: "Billing" },
  { value: "BUG", label: "Bug" },
  { value: "HOWTO", label: "How-to" },
  { value: "FEATURE_REQUEST", label: "Feature request" },
  { value: "ACCOUNT", label: "Account" },
  { value: "OTHER", label: "Other" },
];

export default function NewSupportTicketPage() {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [priority, setPriority] = useState<SupportTicketPriority>("NORMAL");
  const [category, setCategory] = useState<SupportTicketCategory>("TECHNICAL");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const input: RaiseSupportTicketInput = {
        subject: subject.trim(),
        body: body.trim(),
        priority,
        category,
      };
      const thread = await api.raiseSupportTicket(input);
      router.push(`/support/${thread.id}`);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to open the ticket",
      );
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="page-header with-action">
        <div>
          <h1>New ticket</h1>
          <p className="subtitle">
            Describe what you need help with. The support team replies here in
            this thread.
          </p>
        </div>
        <Link href="/support" className="btn btn--ghost">
          ← Back to support
        </Link>
      </div>

      {error && <p className="error">{error}</p>}

      <form onSubmit={submit} style={{ maxWidth: 720 }}>
        <div className="card">
          <div className="field">
            <label>Subject</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Payments aren't going through at checkout"
              maxLength={200}
              required
            />
          </div>

          <div className="form-row">
            <div className="field">
              <label>Priority</label>
              <select
                value={priority}
                onChange={(e) =>
                  setPriority(e.target.value as SupportTicketPriority)
                }
              >
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Category</label>
              <select
                value={category}
                onChange={(e) =>
                  setCategory(e.target.value as SupportTicketCategory)
                }
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label>How can we help?</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Share as much detail as you can — steps, error messages, links…"
              maxLength={5000}
              style={{ minHeight: 160 }}
              required
            />
          </div>
        </div>

        <div className="row-actions" style={{ marginTop: 16 }}>
          <button
            className="btn"
            type="submit"
            disabled={saving || !subject.trim() || !body.trim()}
          >
            {saving ? "Opening…" : "Open ticket"}
          </button>
          <Link href="/support" className="btn btn--ghost">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
