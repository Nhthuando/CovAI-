import { forwardRef } from 'react';
import { cn } from '../../lib/utils';

// shadcn/ui Input, Textarea, native Select and Label.
const field = 'w-full min-w-0 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-3 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] transition-colors duration-150 outline-none hover:border-[var(--color-border-strong)] focus-visible:border-[var(--color-primary)]/60 focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]/30 disabled:cursor-not-allowed disabled:opacity-60';

export const Input = forwardRef(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(field, 'h-9 py-1', className)} {...props} />;
});
export const Textarea = forwardRef(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(field, 'min-h-16 py-2 leading-relaxed', className)} {...props} />;
});
export const NativeSelect = forwardRef(function NativeSelect({ className, ...props }, ref) {
  return <select ref={ref} className={cn(field, 'h-9 cursor-pointer py-1', className)} {...props} />;
});
export function Label({ className, ...props }) {
  return <label className={cn('text-sm font-medium leading-none text-[var(--color-text)]', className)} {...props} />;
}
