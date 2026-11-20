import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '../../lib/utils';

// shadcn/ui Tabs (segmented style).
export function Tabs(props) { return <TabsPrimitive.Root {...props} />; }
export function TabsList({ className, ...props }) {
  return <TabsPrimitive.List className={cn('inline-flex h-9 w-fit max-w-full items-center overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-[3px] text-[var(--color-text-muted)]', className)} {...props} />;
}
export function TabsTrigger({ className, ...props }) {
  return <TabsPrimitive.Trigger className={cn('inline-flex h-full cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors duration-150 outline-none hover:text-[var(--color-text)] focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]/50 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-[var(--color-surface-raised)] data-[state=active]:text-[var(--color-text)] [&_svg]:size-4 [&_svg]:shrink-0', className)} {...props} />;
}
export function TabsContent({ className, ...props }) {
  return <TabsPrimitive.Content className={cn('outline-none', className)} {...props} />;
}
