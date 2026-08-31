import { createHash, randomUUID } from 'node:crypto';

import {
  createProfileRequestSchema,
  profileImportResponseSchema,
  type ProfileImportResponse,
} from '@job-radar/shared';

interface ExtractProfileDraftOptions {
  readonly text: string;
  readonly label: string;
  readonly sourceType: 'pasted_text' | 'file_upload';
  readonly originalFilename?: string;
}

const FIELD_LIMITS = {
  displayName: 100,
  headline: 200,
  currentLocation: 200,
  summary: 2_000,
} as const;

function labeledValue(text: string, label: string, limit: number): string | undefined {
  const expression = new RegExp(`^${label}:\\s*(.+)$`, 'im');
  const value = expression.exec(text)?.[1]?.trim();
  return value && value.length <= limit ? value : undefined;
}

export function extractProfileDraft(
  options: ExtractProfileDraftOptions,
): ProfileImportResponse {
  const sourceId = randomUUID();
  const basics = {
    displayName: labeledValue(options.text, 'Name', FIELD_LIMITS.displayName) ?? '',
    headline: labeledValue(options.text, 'Headline', FIELD_LIMITS.headline),
    currentLocation: labeledValue(options.text, 'Location', FIELD_LIMITS.currentLocation),
    summary: labeledValue(options.text, 'Summary', FIELD_LIMITS.summary),
  };
  const extractedCount = Object.values(basics).filter(Boolean).length;
  const warnings = [
    'No AI extraction ran. This deterministic test substitute reads only Name, Headline, Location, and Summary labels.',
    'Imported values remain pending until you explicitly confirm them.',
  ];
  if (extractedCount === 0) {
    warnings.push('No supported labeled fields were found; no facts were inferred.');
  }

  const source = {
    id: sourceId,
    type: options.sourceType,
    label: options.label,
    ...(options.originalFilename ? { originalFilename: options.originalFilename } : {}),
    contentHash: createHash('sha256').update(options.text).digest('hex'),
  };
  const draft = createProfileRequestSchema.parse({
    changeSummary: 'Created pending draft from deterministic import substitute',
    sources: [source],
    basics: {
      sourceId,
      confirmationStatus: 'pending',
      evidenceExcerpt: 'Exact labeled fields from the imported source',
      data: basics,
    },
    preferences: {
      sourceId,
      confirmationStatus: 'pending',
      evidenceExcerpt: 'No preferences extracted',
      data: {
        targetRoles: [],
        targetLocations: [],
        workModes: [],
        workAuthorization: {
          countries: [],
          status: 'unknown',
          needsSponsorship: false,
        },
      },
    },
  });

  return profileImportResponseSchema.parse({
    extractor: {
      provider: 'deterministic_labeled_text_stub',
      version: 'stub-v1',
      aiUsed: false,
      capability: 'basic_labeled_fields_only',
    },
    draft,
    warnings,
  });
}
