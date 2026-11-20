import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// shadcn/ui class helper: merges conditional classes and resolves Tailwind conflicts.
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
