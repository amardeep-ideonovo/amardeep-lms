import { forwardRef } from "react";

// Shared button for the two DOM apps (web + admin) — docs/coding-standards.md
// D5. A Save vs a Cancel is now ONE component with different props, not
// repeated `<button className="btn …">` markup. The variant/size/modifier props
// map to the canonical `btn--*` classes, which BOTH apps' globals.css style
// identically: admin already uses the `btn--*` family; web adds `btn--*`
// aliases beside its legacy single-dash `.btn-primary` etc. Presentational
// only — no theming logic; colors come from the token layer, so migrating a
// site to <Button> is a visual no-op.
//
// `type` is passed through UNTOUCHED (not defaulted): a bare <button> inside a
// <form> keeps its native submit default, so replacing it with <Button> must
// too. Set type="button" at the call site when you mean a non-submitting
// action (as the raw markup already did).

export type ButtonVariant =
  "primary" | "secondary" | "ghost" | "danger" | "danger-solid" | "add";
export type ButtonSize = "md" | "sm";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "btn--primary",
  secondary: "btn--secondary",
  ghost: "btn--ghost",
  danger: "btn--danger",
  "danger-solid": "btn--danger-solid",
  add: "btn--add",
};

export type ButtonClassOptions = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  iconOnly?: boolean;
  /** Extra classes appended after the canonical `btn--*` ones. */
  className?: string;
};

// The single source of truth for a button's class list. `<Button>` uses it, and
// so must anything that CAN'T be a <button> but should look like one — a
// navigation is an <a>/<Link> (native middle-click, new-tab, prefetch), and a
// file picker is a <label> wrapping a hidden <input>. Those spread this onto
// their className instead of hand-writing `btn btn--primary`, so every button-
// shaped control shares one definition.
export function buttonClass({
  variant = "primary",
  size = "md",
  block = false,
  iconOnly = false,
  className,
}: ButtonClassOptions = {}): string {
  return [
    "btn",
    VARIANT_CLASS[variant],
    size === "sm" && "btn--sm",
    block && "btn--block",
    iconOnly && "btn--icon",
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Visual role. Default "primary". */
  variant?: ButtonVariant;
  /** "sm" = the compact toolbar/table size. Default "md". */
  size?: ButtonSize;
  /** Full-width (width: 100%). */
  block?: boolean;
  /** Square icon-only button — pass an aria-label (the label lives there). */
  iconOnly?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      block = false,
      iconOnly = false,
      className,
      children,
      ...rest
    },
    ref,
  ) {
    const cls = buttonClass({ variant, size, block, iconOnly, className });
    return (
      <button ref={ref} className={cls} {...rest}>
        {children}
      </button>
    );
  },
);
