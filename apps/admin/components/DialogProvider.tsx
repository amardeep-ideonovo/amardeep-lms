"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

// In-app replacements for window.confirm / window.alert / window.prompt, themed
// to match the admin (dark + light). All three return a Promise so call sites
// stay almost identical: `if (await confirm(...)) { ... }`.
type Kind = "confirm" | "notify" | "prompt";

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}
interface NotifyOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
}
interface PromptOptions extends ConfirmOptions {
  defaultValue?: string;
  placeholder?: string;
  inputType?: string; // e.g. "password"
}

interface DialogState {
  kind: Kind;
  opts: ConfirmOptions & PromptOptions;
  resolve: (value: boolean | string | null | void) => void;
}

interface DialogContextValue {
  confirm: (opts: ConfirmOptions | string) => Promise<boolean>;
  notify: (opts: NotifyOptions | string) => Promise<void>;
  prompt: (opts: PromptOptions | string) => Promise<string | null>;
}

const Ctx = createContext<DialogContextValue>({
  confirm: async () => false,
  notify: async () => {},
  prompt: async () => null,
});

function normalize(
  opts: ConfirmOptions | PromptOptions | NotifyOptions | string,
): ConfirmOptions & PromptOptions {
  return typeof opts === "string" ? { message: opts } : opts;
}

// Imperative singleton so any call site can do `dialog.confirm(...)` without a
// hook — works in nested components and plain helpers. The mounted DialogProvider
// registers itself here; if (somehow) no provider is mounted, we fall back to the
// native dialogs so a call never silently no-ops.
let registry: DialogContextValue | null = null;
export const dialog: DialogContextValue = {
  confirm: (o) =>
    registry
      ? registry.confirm(o)
      : Promise.resolve(window.confirm(typeof o === "string" ? o : o.message)),
  notify: (o) => {
    if (registry) return registry.notify(o);
    window.alert(typeof o === "string" ? o : o.message);
    return Promise.resolve();
  },
  prompt: (o) => {
    if (registry) return registry.prompt(o);
    const opts = normalize(o);
    return Promise.resolve(window.prompt(opts.message, opts.defaultValue ?? ""));
  },
};

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DialogState | null>(null);
  const [value, setValue] = useState(""); // prompt input value
  const inputRef = useRef<HTMLInputElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);

  const open = useCallback(
    (kind: Kind, raw: ConfirmOptions | PromptOptions | NotifyOptions | string) =>
      new Promise<boolean | string | null | void>((resolve) => {
        const opts = normalize(raw);
        setValue(opts.defaultValue ?? "");
        setState({ kind, opts, resolve });
      }),
    [],
  );

  const confirm = useCallback(
    (o: ConfirmOptions | string) => open("confirm", o) as Promise<boolean>,
    [open],
  );
  const notify = useCallback(
    (o: NotifyOptions | string) => open("notify", o) as Promise<void>,
    [open],
  );
  const prompt = useCallback(
    (o: PromptOptions | string) => open("prompt", o) as Promise<string | null>,
    [open],
  );

  // Resolve the pending promise and close. `cancelled` picks the right "no"
  // value per kind (false / null / void).
  const finish = useCallback(
    (cancelled: boolean) => {
      setState((s) => {
        if (!s) return null;
        if (cancelled)
          s.resolve(
            s.kind === "confirm" ? false : s.kind === "prompt" ? null : undefined,
          );
        else
          s.resolve(
            s.kind === "confirm"
              ? true
              : s.kind === "prompt"
                ? valueRef.current
                : undefined,
          );
        return null;
      });
    },
    [],
  );

  // Keep the latest input value readable from finish() without re-creating it.
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  // Register this provider as the imperative singleton (see `dialog` above).
  useEffect(() => {
    registry = { confirm, notify, prompt };
    return () => {
      registry = null;
    };
  }, [confirm, notify, prompt]);

  // Focus the input (prompt) or the confirm button; wire Esc to cancel.
  useEffect(() => {
    if (!state) return;
    const t = setTimeout(() => {
      if (state.kind === "prompt") inputRef.current?.focus();
      else okRef.current?.focus();
    }, 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        finish(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [state, finish]);

  const o = state?.opts;

  return (
    <Ctx.Provider value={{ confirm, notify, prompt }}>
      {children}
      {state && o && (
        <div
          className="modal-overlay modal-overlay--center"
          onMouseDown={() => finish(true)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="modal modal--confirm"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="modal-body">
              <h2 className="dialog-title">{o.title ?? defaultTitle(state.kind)}</h2>
              <p className="dialog-message">{o.message}</p>
              {state.kind === "prompt" && (
                <input
                  ref={inputRef}
                  className="dialog-input"
                  type={o.inputType ?? "text"}
                  value={value}
                  placeholder={o.placeholder}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      finish(false);
                    }
                  }}
                />
              )}
              <div className="dialog-actions">
                {state.kind !== "notify" && (
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => finish(true)}
                  >
                    {o.cancelLabel ?? "Cancel"}
                  </button>
                )}
                <button
                  ref={okRef}
                  type="button"
                  className={o.danger ? "btn btn--danger-solid" : "btn"}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => finish(false)}
                >
                  {o.confirmLabel ?? defaultOk(state.kind)}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

function defaultTitle(kind: Kind): string {
  return kind === "notify" ? "Notice" : kind === "prompt" ? "Enter a value" : "Are you sure?";
}
function defaultOk(kind: Kind): string {
  return kind === "notify" ? "OK" : kind === "prompt" ? "Save" : "Confirm";
}

export function useDialog(): DialogContextValue {
  return useContext(Ctx);
}
