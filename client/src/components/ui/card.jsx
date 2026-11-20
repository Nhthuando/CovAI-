import { cn } from '../../lib/utils';

// shadcn/ui Card family.
export function Card({ className, ...props }) {
  return <div className={cn('flex min-w-0 flex-col gap-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-5 text-[var(--color-text)]', className)} {...props} />;
}
export function CardHeader({ className, ...props }) {
  return <div className={cn('grid auto-rows-min items-start gap-1 px-5 has-[[data-slot=card-action]]:grid-cols-[1fr_auto]', className)} {...props} />;
}
export function CardTitle({ className, ...props }) {
  return <h3 className={cn('text-sm font-semibold leading-snug tracking-tight', className)} {...props} />;
}
export function CardDescription({ className, ...props }) {
  return <p className={cn('text-sm text-[var(--color-text-muted)]', className)} {...props} />;
}
export function CardAction({ className, ...props }) {
  return <div data-slot="card-action" className={cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end', className)} {...props} />;
}
export function CardContent({ className, ...props }) {
  return <div className={cn('px-5', className)} {...props} />;
}
export function CardFooter({ className, ...props }) {
  return <div className={cn('flex items-center gap-2 border-t border-[var(--color-border)] px-5 pt-4', className)} {...props} />;
}
