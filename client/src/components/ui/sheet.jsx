import * as SheetPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

// shadcn/ui Sheet (side panel built on Radix Dialog).
export function Sheet(props) { return <SheetPrimitive.Root {...props} />; }
export function SheetTrigger(props) { return <SheetPrimitive.Trigger {...props} />; }
export function SheetClose(props) { return <SheetPrimitive.Close {...props} />; }
export function SheetContent({ className, children, side = 'right', ...props }) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60" />
      <SheetPrimitive.Content className={cn(
        'fixed z-50 flex flex-col bg-[var(--color-surface)] text-[var(--color-text)] shadow-xl outline-none',
        side === 'right' && 'inset-y-0 right-0 h-full w-full border-l border-[var(--color-border)] sm:max-w-xl',
        side === 'left' && 'inset-y-0 left-0 h-full w-full border-r border-[var(--color-border)] sm:max-w-xl',
        className)} {...props}>
        {children}
        <SheetPrimitive.Close className="absolute right-4 top-4 cursor-pointer rounded-md p-1 text-[var(--color-text-muted)] outline-none transition-colors duration-150 hover:bg-[var(--color-surface-secondary)] hover:text-[var(--color-text)] focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]/50">
          <X className="size-4" />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}
export function SheetHeader({ className, ...props }) {
  return <div className={cn('flex flex-col gap-1.5 border-b border-[var(--color-border)] p-5 pr-12', className)} {...props} />;
}
export function SheetTitle({ className, ...props }) {
  return <SheetPrimitive.Title className={cn('font-semibold tracking-tight', className)} {...props} />;
}
export function SheetDescription({ className, ...props }) {
  return <SheetPrimitive.Description className={cn('text-sm text-[var(--color-text-muted)]', className)} {...props} />;
}
export function SheetBody({ className, ...props }) {
  return <div className={cn('min-h-0 flex-1 space-y-6 overflow-y-auto p-5', className)} {...props} />;
}
