export function Card({
  children,
  className = "",
  interactive = false,
  variant = "default",
  ...props
}) {
  const base =
    "border rounded-[var(--radius-lg)] transition-colors duration-150";

  const variants = {
    default:
      "bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text)]",
    secondary:
      "bg-[var(--color-surface-secondary)] border-[var(--color-border)] text-[var(--color-text)]",
    outlined:
      "bg-transparent border-[var(--color-border)] text-[var(--color-text)]",
  };

  const interactiveStyles = interactive
    ? "hover:border-[var(--color-primary)] cursor-pointer"
    : "";

  return (
    <div
      className={`${base} ${variants[variant] || variants.default} ${interactiveStyles} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className = "", ...props }) {
  return (
    <div
      className={`p-5 border-b border-[var(--color-border)] flex items-center justify-between gap-4 ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardContent({ children, className = "", ...props }) {
  return (
    <div className={`p-5 ${className}`} {...props}>
      {children}
    </div>
  );
}

export function CardFooter({ children, className = "", ...props }) {
  return (
    <div
      className={`p-5 pt-0 border-t border-[var(--color-border)] flex items-center justify-between gap-4 ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export default Card;
