import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils';

// shadcn/ui Badge with CovAI semantic tints (10% fill, 20% border).
// eslint-disable-next-line react-refresh/only-export-components
export const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium [&_svg]:size-3 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-[var(--color-primary)]/15 text-[var(--color-primary)]',
        secondary: 'border-[var(--color-border)] bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)]',
        outline: 'border-[var(--color-border)] text-[var(--color-text-secondary)]',
        success: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400',
        danger: 'border-rose-500/20 bg-rose-500/10 text-rose-400',
        warning: 'border-amber-500/20 bg-amber-500/10 text-amber-400',
        info: 'border-sky-500/20 bg-sky-500/10 text-sky-400',
      },
    },
    defaultVariants: { variant: 'secondary' },
  },
);

export function Badge({ className, variant, ...props }) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
