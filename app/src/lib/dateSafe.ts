/**
 * Safe date formatting utilities.
 * Wraps date-fns with try/catch to prevent "Invalid time value" crashes.
 */
import { format, parseISO, isValid } from 'date-fns';

/** Safely format a date string, returning fallback on error */
export function safeFormat(
  dateValue: string | Date | null | undefined,
  fmt: string = 'MMM d HH:mm',
  fallback: string = '—'
): string {
  if (!dateValue) return fallback;
  try {
    let date: Date;
    if (dateValue instanceof Date) {
      date = dateValue;
    } else if (typeof dateValue === 'string') {
      if (dateValue.includes('T') || dateValue.match(/^\d{4}-\d{2}-\d{2}/)) {
        date = parseISO(dateValue);
      } else {
        date = new Date(dateValue);
      }
    } else {
      return fallback;
    }
    if (!isValid(date)) return fallback;
    return format(date, fmt);
  } catch {
    return fallback;
  }
}

/** Safely parse a date string, returning null on error */
export function safeParse(dateValue: string | null | undefined): Date | null {
  if (!dateValue) return null;
  try {
    let date: Date;
    if (dateValue.includes('T') || dateValue.match(/^\d{4}-\d{2}-\d{2}/)) {
      date = parseISO(dateValue);
    } else {
      date = new Date(dateValue);
    }
    return isValid(date) ? date : null;
  } catch {
    return null;
  }
}