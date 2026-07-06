"use client";

import { useState } from "react";
import { addHost } from "@/lib/provisioner";
import { Field, Modal } from "./ui";

export function AddHostModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [region, setRegion] = useState("Frankfurt");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Add host" onClose={onClose} width={400}>
      <div className="modal-body">
        <p className="modal-note">
          Registers a VPS with the fleet. New instances are placed on the least-loaded host.
        </p>
        <Field label="Host name">
          <input
            className="input mono"
            placeholder="vps-4"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </Field>
        <Field label="Region">
          <select className="input" value={region} onChange={(e) => setRegion(e.target.value)}>
            <option>Frankfurt</option>
            <option>Amsterdam</option>
            <option>London</option>
            <option>New York</option>
            <option>Singapore</option>
          </select>
        </Field>
      </div>
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !name.trim()}
          onClick={async () => {
            setBusy(true);
            await addHost(name.trim(), region);
            onClose();
          }}
        >
          {busy ? "Adding…" : "Add host"}
        </button>
      </div>
    </Modal>
  );
}
