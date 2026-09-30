import { forwardRef } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";

export const Button = forwardRef(function Button(
  {
    children,
    variant = "primary",
    size = "md",
    className = "",
    disabled = false,
    loading = false,
    icon: Icon,
    iconPosition = "left",
    as: Component = "button",
    to,
    href,
    type = "button",
    onClick,
    ...props
  },
  ref,
) {
  const baseStyles =
    "inline-flex items-center justify-center font-medium transition-colors duration-150 select-none cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] focus-visible:outline-offset-2 disabled:opacity-50 disabled:pointer-events-none disabled:cursor-not-allowed";

  const sizeStyles = {
    sm: "h-8 px-3 text-xs gap-1.5 rounded-[var(--radius-sm)]",
    md: "h-9 px-4 text-sm gap-2 rounded-[var(--radius-md)]",
    lg: "h-11 px-5 text-base gap-2.5 rounded-[var(--radius-md)]",
  };

  const variantStyles = {
    primary:
      "bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)] active:bg-[var(--color-primary-active)] border border-transparent",
    secondary:
      "bg-[var(--color-surface-secondary)] text-[var(--color-text)] hover:bg-[var(--color-border)] border border-[var(--color-border)]",
    outline:
      "bg-transparent text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] border border-[var(--color-border)] active:bg-[var(--color-surface)]",
    ghost:
      "bg-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] border border-transparent",
    danger:
      "bg-[var(--color-danger)] text-white hover:bg-red-700 active:bg-red-800 border border-transparent",
  };

  const classes = `${baseStyles} ${sizeStyles[size] || sizeStyles.md} ${
    variantStyles[variant] || variantStyles.primary
  } ${className}`;

  const content = (
    <>
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin shrink-0" />
      ) : (
        Icon && iconPosition === "left" && <Icon className="w-4 h-4 shrink-0" />
      )}
      <span>{children}</span>
      {!loading && Icon && iconPosition === "right" && (
        <Icon className="w-4 h-4 shrink-0" />
      )}
    </>
  );

  if (to) {
    return (
      <Link to={to} className={classes} ref={ref} {...props}>
        {content}
      </Link>
    );
  }

  if (href) {
    return (
      <a href={href} className={classes} ref={ref} {...props}>
        {content}
      </a>
    );
  }

  return (
    <Component
      ref={ref}
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      className={classes}
      {...props}
    >
      {content}
    </Component>
  );
});

export default Button;
