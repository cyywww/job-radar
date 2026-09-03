import type { ReviewJobSummary } from '@job-radar/shared';

export function formatDate(value: string | null): string {
  if (!value) return 'Not specified';
  return new Intl.DateTimeFormat('en-SE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function lifecycleLabel(status: ReviewJobSummary['lifecycleStatus']): string {
  return status === 'possibly_closed' ? 'possibly closed' : status;
}

export function safeExternalHref(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}
