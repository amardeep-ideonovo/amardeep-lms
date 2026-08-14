import React, { useEffect, useState } from "react";

import {
  API_BASE_URL,
  IS_LOCKED_BUILD,
  loadInstanceBinding,
  setUnbindListener,
} from "./config";
import { ConnectScreen } from "./screens/ConnectScreen";
import { WelcomeScreen } from "./screens/WelcomeScreen";

// Boot gate for the SHARED app: restores the persisted instance binding (or
// walks first-run users through Welcome → Connect), and only then lets the app
// tree mount, so every provider below initializes against the bound instance.
// Locked (white-label / dev) builds pass straight through.
//
// The key on the fragment remounts the ENTIRE app tree when the bound instance
// changes — auth, cached branding, and navigation state must never survive a
// switch between instances.
export function InstanceGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"loading" | "unbound" | "bound">(
    IS_LOCKED_BUILD ? "bound" : "loading",
  );
  // The branded landing ("Start here") shows only on a cold unbound start —
  // a fresh install. An explicit "Switch academy" unbind skips it: that user
  // is deliberately heading for the Connect form, not a welcome tour.
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (IS_LOCKED_BUILD) return;
    void loadInstanceBinding().then((b) => setState(b ? "bound" : "unbound"));
    // "Switch academy" (LoginScreen) unbinds; land straight on Connect.
    setUnbindListener(() => {
      setStarted(true);
      setState("unbound");
    });
    return () => setUnbindListener(null);
  }, []);

  if (state === "loading") return null; // native splash stays up
  if (state === "unbound") {
    return started ? (
      <ConnectScreen onConnected={() => setState("bound")} />
    ) : (
      <WelcomeScreen onStart={() => setStarted(true)} />
    );
  }
  return <React.Fragment key={API_BASE_URL}>{children}</React.Fragment>;
}
