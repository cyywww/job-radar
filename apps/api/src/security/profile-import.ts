import { basename, extname } from 'node:path';

import { AppError } from '@job-radar/shared';

export const MAX_PROFILE_FILE_BYTES = 512 * 1024;
export const ALLOWED_PROFILE_FILE_TYPES = ['text/plain', 'text/markdown'] as const;

export function validateProfileFilename(value: unknown): string {
  if (typeof value !== 'string') {
    throw new AppError(
      'PROFILE_FILE_NAME_REQUIRED',
      'The x-file-name header is required',
      400,
    );
  }

  const filename = value.trim();
  if (
    filename.length === 0 ||
    filename.length > 120 ||
    filename.includes('\0') ||
    filename.includes('/') ||
    filename.includes('\\') ||
    filename.includes('..') ||
    basename(filename) !== filename
  ) {
    throw new AppError(
      'PROFILE_FILE_NAME_INVALID',
      'The file name must be a simple local file name',
      400,
    );
  }

  if (!['.txt', '.md'].includes(extname(filename).toLowerCase())) {
    throw new AppError(
      'PROFILE_FILE_TYPE_UNSUPPORTED',
      'Only .txt and .md profile files are accepted',
      415,
    );
  }

  return filename;
}

export function validateProfileContentType(value: string | undefined): void {
  const contentType = value?.split(';', 1)[0]?.trim().toLowerCase();
  if (
    !contentType ||
    !ALLOWED_PROFILE_FILE_TYPES.includes(
      contentType as (typeof ALLOWED_PROFILE_FILE_TYPES)[number],
    )
  ) {
    throw new AppError(
      'PROFILE_FILE_TYPE_UNSUPPORTED',
      'Only text/plain and text/markdown profile files are accepted',
      415,
    );
  }
}
