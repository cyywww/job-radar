import { describe, expect, it } from 'vitest';

import { validateProfileContentType, validateProfileFilename } from './profile-import.js';

describe('profile file import security', () => {
  it('accepts simple text and Markdown file names', () => {
    expect(validateProfileFilename('fictional-profile.txt')).toBe(
      'fictional-profile.txt',
    );
    expect(() =>
      validateProfileContentType('text/markdown; charset=utf-8'),
    ).not.toThrow();
  });

  it.each(['../resume.txt', '..\\resume.md', 'folder/resume.txt', 'resume.pdf'])(
    'rejects unsafe or unsupported file name %s',
    (filename) => expect(() => validateProfileFilename(filename)).toThrow(),
  );

  it('rejects unsupported content types', () => {
    expect(() => validateProfileContentType('application/pdf')).toThrow();
  });
});
