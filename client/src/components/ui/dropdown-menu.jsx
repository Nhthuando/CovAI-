import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";

const itemClass = "relative flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors duration-150 hover:bg-[var(--color-surface-secondary)] data-[highlighted]:bg-[var(--color-surface-secondary)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";

// eslint-disable-next-line react-refresh/only-export-components
export const DropdownMenu = Dropdown.Root;
// eslint-disable-next-line react-refresh/only-export-components
export const DropdownMenuTrigger = Dropdown.Trigger;

export function DropdownMenuContent({ className = "", sideOffset = 4, ...props }) {
  return (
    <Dropdown.Portal>
      <Dropdown.Content
        sideOffset={sideOffset}
        className={`z-50 min-w-[12rem] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-1 text-[var(--color-text)] shadow-sm ${className}`}
        {...props}
      />
    </Dropdown.Portal>
  );
}

export function DropdownMenuItem({ className = "", ...props }) {
  return <Dropdown.Item className={`${itemClass} ${className}`} {...props} />;
}

export function DropdownMenuCheckboxItem({ className = "", children, ...props }) {
  return (
    <Dropdown.CheckboxItem className={`${itemClass} ${className}`} {...props}>
      <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
        <Dropdown.ItemIndicator><Check /></Dropdown.ItemIndicator>
      </span>
      {children}
    </Dropdown.CheckboxItem>
  );
}

export function DropdownMenuSeparator({ className = "", ...props }) {
  return <Dropdown.Separator className={`my-1 h-px bg-[var(--color-border)] ${className}`} {...props} />;
}

export function DropdownMenuLabel({ className = "", ...props }) {
  return <Dropdown.Label className={`px-2 py-1.5 text-xs font-medium text-[var(--color-text-muted)] ${className}`} {...props} />;
}
