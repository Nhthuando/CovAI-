import { cn } from '../../lib/utils';

// shadcn/ui Table family.
export function Table({ className, ...props }) {
  return (
    <div className="relative w-full overflow-x-auto">
      <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  );
}
export function TableHeader({ className, ...props }) {
  return <thead className={cn('[&_tr]:border-b [&_tr]:border-[var(--color-border)] [&_tr:hover]:bg-transparent', className)} {...props} />;
}
export function TableBody({ className, ...props }) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}
export function TableRow({ className, ...props }) {
  return <tr className={cn('border-b border-[var(--color-border)] transition-colors duration-150 hover:bg-[var(--color-surface-secondary)]/60', className)} {...props} />;
}
export function TableHead({ className, ...props }) {
  return <th className={cn('h-9 whitespace-nowrap px-3 text-left align-middle text-xs font-medium text-[var(--color-text-muted)]', className)} {...props} />;
}
export function TableCell({ className, ...props }) {
  return <td className={cn('px-3 py-2.5 align-middle', className)} {...props} />;
}
