import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Escape user-supplied strings for use in SQL ILIKE patterns.
 * Escapes the three metacharacters: % _ \
 * Caller wraps the result with % as needed, e.g. `%${escapeLikePattern(q)}%`.
 */
export function escapeLikePattern(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}
