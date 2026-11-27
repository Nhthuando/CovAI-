import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '../../lib/utils';

// shadcn/ui Tooltip.
export function TooltipProvider(props) { return <TooltipPrimitive.Provider {...props} />; }
export function Tooltip(props) { return <TooltipPrimitive.Root {...props} />; }
export function TooltipTrigger(props) { return <TooltipPrimitive.Trigger {...props} />; }
export function TooltipContent({ className, sideOffset = 6, children, ...props }) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content sideOffset={sideOffset}
        className={cn('z-50 max-w-xs rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-1.5 text-xs leading-relaxed text-[var(--color-text)] shadow-md', className)} {...props}>
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}
// Convenience wrapper: <Hint text="..."><button /></Hint>
export function Hint({ text, side = 'top', children }) {
  if (!text) return children;
  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side}>{text}</TooltipContent>
      </Tooltip>
    </TooltipPrimitive.Provider>
  );
}
