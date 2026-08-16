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

type Variant = "primary" | "secondary" | "danger" | "danger-solid" | "add";
type Size = "md" | "sm";

const VARIANT_CLASS: Record<Variant, string> = {
  primary: "btn--primary",
  secondary: "btn--secondary",
  danger: "btn--danger",
  "danger-solid": "btn--danger-solid",
  add: "btn--add",
};

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Visual role. Default "primary". */
  variant?: Variant;
  /** "sm" = the compact toolbar/table size. Default "md". */
  size?: Size;
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
    const cls = [
      "btn",
      VARIANT_CLASS[variant],
      size === "sm" && "btn--sm",
      block && "btn--block",
      iconOnly && "btn--icon",
      className,
    ]
      .filter(Boolean)
      .join(" ");
    return (
      <button ref={ref} className={cls} {...rest}>
        {children}
      </button>
    );
  },
);
