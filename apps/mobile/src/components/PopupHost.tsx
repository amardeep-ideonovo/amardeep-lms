// Native popup host. Shows the ACTIVE popups that match the current context
// (the dashboard, or a CMS page) in a RN <Modal>. The API does all visibility
// filtering — this just fetches + renders. The popup body is a Puck document
// rendered by the SAME native PageRenderer used for CMS pages, wrapped in a box
// styled from the popup's presentation settings (background/border/radius/
// padding) and placed per its `position`.
//
// Display behaviour: EVERY visit — appears on mount/focus; the close button
// hides it for this view only (no persistence), so it reappears next time.
import React, { useCallback, useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import type {
  PopupContext,
  PopupPosition,
  PopupPublicDTO,
} from "@lms/types";

import { api } from "../api";
import { PageRenderer } from "./PageRenderer";
import { spacing } from "../theme";

// Map a popup position to overlay flex alignment (column layout:
// justifyContent = vertical, alignItems = horizontal).
function overlayAlign(pos: PopupPosition): {
  justifyContent: "flex-start" | "center" | "flex-end";
  alignItems: "flex-start" | "center" | "flex-end";
} {
  switch (pos) {
    case "TOP":
      return { justifyContent: "flex-start", alignItems: "center" };
    case "BOTTOM":
      return { justifyContent: "flex-end", alignItems: "center" };
    case "TOP_LEFT":
      return { justifyContent: "flex-start", alignItems: "flex-start" };
    case "TOP_RIGHT":
      return { justifyContent: "flex-start", alignItems: "flex-end" };
    case "BOTTOM_LEFT":
      return { justifyContent: "flex-end", alignItems: "flex-start" };
    case "BOTTOM_RIGHT":
      return { justifyContent: "flex-end", alignItems: "flex-end" };
    case "CENTER":
    default:
      return { justifyContent: "center", alignItems: "center" };
  }
}

// Resolve a CSS width string ("480px", "90%", "auto") to a pixel width that
// fits the screen.
function resolveWidth(width: string, screenW: number): number {
  const w = (width || "").trim();
  const max = screenW - 32;
  if (w.endsWith("%")) {
    const pct = parseFloat(w);
    if (!Number.isNaN(pct)) return Math.min(max, (pct / 100) * screenW);
  }
  const px = parseFloat(w);
  if (!Number.isNaN(px) && /^\d/.test(w)) return Math.min(max, px);
  return Math.min(max, 480); // auto / unknown
}

function PopupModal({
  popup,
  onClose,
}: {
  popup: PopupPublicDTO;
  onClose: () => void;
}) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const s = popup.style;
  const align = overlayAlign(s.position);
  const boxWidth = resolveWidth(s.width, screenW);

  // Count one impression when the popup appears.
  useEffect(() => {
    api.recordPopupEvent(popup.id, "view");
  }, [popup.id]);

  const handleClose = () => {
    api.recordPopupEvent(popup.id, "dismiss");
    onClose();
  };

  return (
    <Modal transparent visible animationType="fade" onRequestClose={handleClose}>
      {/* Dim backdrop — tap outside the box to dismiss. */}
      <Pressable style={styles.backdrop} onPress={handleClose} />
      <View style={[styles.overlay, align]} pointerEvents="box-none">
        <View
          style={[
            styles.box,
            {
              width: boxWidth,
              maxHeight: screenH * 0.85,
              backgroundColor: s.background || "#ffffff",
              borderColor: s.borderColor || "#e2e8f0",
              borderRadius: s.borderRadius,
              padding: s.padding,
            },
          ]}
        >
          <TouchableOpacity
            style={styles.close}
            onPress={handleClose}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.closeText}>×</Text>
          </TouchableOpacity>
          <ScrollView showsVerticalScrollIndicator={false}>
            <PageRenderer data={popup.data} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function PopupHost({ context }: { context: PopupContext }) {
  const [popups, setPopups] = useState<PopupPublicDTO[]>([]);
  const [closed, setClosed] = useState<Set<string>>(new Set());

  const ctxKey =
    context.type === "page" ? `page:${context.pageId}` : "dashboard";

  const load = useCallback(async () => {
    try {
      setPopups(await api.activePopups(context));
    } catch {
      setPopups([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxKey]);

  useEffect(() => {
    let alive = true;
    load().then(() => {
      if (!alive) return;
    });
    return () => {
      alive = false;
    };
  }, [load]);

  // Show the first popup that hasn't been dismissed in this view.
  const popup = popups.find((p) => !closed.has(p.id)) ?? null;
  if (!popup) return null;

  return (
    <PopupModal
      popup={popup}
      onClose={() => setClosed((prev) => new Set(prev).add(popup.id))}
    />
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15,23,42,0.5)",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    padding: spacing.md,
  },
  box: {
    borderWidth: 1,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 12,
  },
  close: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 28,
    height: 28,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(15,23,42,0.08)",
    zIndex: 1,
  },
  closeText: { fontSize: 18, lineHeight: 20, color: "#0f172a" },
});
