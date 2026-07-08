"use client";

// Slim pill switcher shown when a client owns more than one instance —
// selection is shared (and persisted) across the overview, every section
// page and the shell's "Open admin" via lib/instance-selection.

import { displayStatus } from "@/lib/provisioner";
import type { Instance } from "@/lib/types";

export function InstanceSwitcher({
  instances,
  selectedId,
  onSelect,
}: {
  instances: Instance[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="iswitch" role="tablist" aria-label="Your instances">
      {instances.map((inst) => {
        const status = displayStatus(inst);
        const active = inst.id === selectedId;
        return (
          <button
            key={inst.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`iswitch-pill${active ? " active" : ""}`}
            onClick={() => onSelect(inst.id)}
          >
            <span className={`chip-dot tone-${status.tone}`} />
            {inst.clientName}
            <span className="iswitch-domain">{inst.domain}</span>
          </button>
        );
      })}
    </div>
  );
}
