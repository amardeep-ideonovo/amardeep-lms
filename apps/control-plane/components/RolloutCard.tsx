"use client";

// Rollout card (frame 1a) — target version, staged waves, pause/resume with
// confirm, "View plan" dialog. Shared by the operator dashboard + Updates page.

import { useState } from "react";
import { pauseRollout, resumeRollout } from "@/lib/provisioner";
import type { Rollout } from "@/lib/types";
import { Icon } from "./icons";
import { ConfirmModal, Modal, Pill } from "./ui";

export function RolloutCard({ rollout }: { rollout: Rollout }) {
  const [confirmPause, setConfirmPause] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const paused = rollout.status === "Paused";
  const pct = Math.round((rollout.updated / rollout.total) * 100);

  return (
    <div className="card">
      <div className="card-head" style={{ marginBottom: 6 }}>
        <span className="card-title">Rollout — {rollout.targetVersion}</span>
        <div className="card-head-spacer" />
        <Pill tone={paused ? "warning" : "info"}>{rollout.status}</Pill>
      </div>
      <div className="rollout-meta">
        <span>
          {rollout.updated} of {rollout.total} instances updated
        </span>
        <span className="rollout-pct">{pct}%</span>
      </div>
      <div className="rollout-track">
        <div className={`rollout-fill${paused ? " paused" : ""}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="wave-list">
        {rollout.waves.map((wave) => (
          <span key={wave.name} className={`wave-row${wave.state === "active" ? " active" : ""}`}>
            {wave.state === "done" ? (
              <span className="wave-check">
                <Icon name="check" size={13} />
              </span>
            ) : (
              <span
                className={`wave-dot ${wave.state === "active" ? "active" : "pending"}${
                  wave.state === "active" && !paused ? " pulse" : ""
                }`}
              />
            )}
            {wave.name} ({wave.size}) — {wave.state === "active" && paused ? "paused" : wave.note}
          </span>
        ))}
      </div>
      <div className="card-btn-row">
        {paused ? (
          <button type="button" className="btn-line" onClick={() => resumeRollout()}>
            Resume
          </button>
        ) : (
          <button type="button" className="btn-line" onClick={() => setConfirmPause(true)}>
            Pause
          </button>
        )}
        <button type="button" className="btn-line btn-line-ink" onClick={() => setPlanOpen(true)}>
          View plan
        </button>
      </div>

      {confirmPause && (
        <ConfirmModal
          title="Pause rollout?"
          body={
            <>
              <div className="warn-box">
                In-flight instance updates will finish, but no new instances start on{" "}
                {rollout.targetVersion} until you resume.
              </div>
              <p className="modal-note">
                {rollout.total - rollout.updated} instances are still waiting on the current wave.
              </p>
            </>
          }
          confirmLabel="Pause rollout"
          onConfirm={() => pauseRollout()}
          onClose={() => setConfirmPause(false)}
        />
      )}

      {planOpen && (
        <Modal title={`Rollout plan — ${rollout.targetVersion}`} onClose={() => setPlanOpen(false)} width={460}>
          <div className="modal-body">
            <div className="wave-list" style={{ marginTop: 0 }}>
              {rollout.waves.map((wave) => (
                <span key={wave.name} className={`wave-row${wave.state === "active" ? " active" : ""}`}>
                  {wave.state === "done" ? (
                    <span className="wave-check">
                      <Icon name="check" size={13} />
                    </span>
                  ) : (
                    <span className={`wave-dot ${wave.state === "active" ? "active" : "pending"}`} />
                  )}
                  {wave.name} ({wave.size}) — {wave.note}
                </span>
              ))}
            </div>
            <div>
              {rollout.policy.map((line) => (
                <div key={line} className="boot-step">
                  <span className="boot-num">✓</span>
                  {line}
                </div>
              ))}
            </div>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setPlanOpen(false)}>
              Close
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
