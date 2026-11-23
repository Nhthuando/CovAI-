import { forwardRef } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

// shadcn/ui Button, mapped to CovAI design tokens.
// eslint-disable-next-line react-refresh/only-export-components
export const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all duration-150 cursor-pointer select-none outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]/50 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:bg-[var(--color-primary-hover)]',
        secondary: 'border border-[var(--color-border)] bg-[var(--color-surface-secondary)] text-[var(--color-text)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-raised)]',
        outline: 'border border-[var(--color-border)] bg-transparent text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)]',
        ghost: 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)] hover:text-[var(--color-text)]',
        destructive: 'border border-rose-500/30 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20',
        link: 'h-auto px-0 text-[var(--color-primary)] underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-10 px-6',
        icon: 'size-9',
        'icon-sm': 'size-8',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

// Accepts the older CovAI Button props too (variant="primary", size="md", loading) so screens can switch over unchanged.
const legacyVariant = { primary: 'default', danger: 'destructive' };
const legacySize = { md: 'default' };

export const Button = forwardRef(function Button({
  className, variant, size, asChild = false, type = 'button', loading = false, disabled, children, ...props
}, ref) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp ref={ref} type={asChild ? undefined : type} disabled={asChild ? undefined : disabled || loading}
      className={cn(buttonVariants({ variant: legacyVariant[variant] || variant, size: legacySize[size] || size }), className)} {...props}>
      {asChild ? children : <>{loading && <Loader2 className="animate-spin" aria-hidden="true" />}{children}</>}
    </Comp>
  );
});
