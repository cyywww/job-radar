import { describe, expect, it } from 'vitest';

import { extractProfileDraft } from './profile-import.js';

describe('deterministic profile import substitute', () => {
  it('extracts only explicitly labeled basics as pending facts', () => {
    const result = extractProfileDraft({
      sourceType: 'pasted_text',
      label: 'Fictional pasted text',
      text: [
        'Name: Robin North',
        'Location: Stockholm',
        'Headline: Fictional product engineer',
        'Skills: Rust, TypeScript',
      ].join('\n'),
    });

    expect(result.extractor.aiUsed).toBe(false);
    expect(result.draft.basics.confirmationStatus).toBe('pending');
    expect(result.draft.basics.data.displayName).toBe('Robin North');
    expect(result.draft.skills).toEqual([]);
    expect(result.warnings.join(' ')).toMatch(/No AI extraction ran/);
  });

  it('does not infer facts from unlabeled prose', () => {
    const rawMarker = 'PRIVATE-RAW-MARKER-IS-NOT-A-FACT';
    const result = extractProfileDraft({
      sourceType: 'file_upload',
      label: 'Local fictional file',
      originalFilename: 'fictional.md',
      text: `Robin built a made-up service using imaginary tools. ${rawMarker}`,
    });

    expect(result.draft.basics.data.displayName).toBe('');
    expect(result.warnings.join(' ')).toMatch(/no facts were inferred/i);
    expect(result.draft.sources[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toContain(rawMarker);
  });
});
