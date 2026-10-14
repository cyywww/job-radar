import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import App from './App.js';

const feed = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  jobs: [
    {
      id: 'fictional-1',
      title: 'Software Engineer',
      company: 'Example AB',
      location: 'Stockholm',
      region: 'Stockholm',
      publishedAt: '2026-10-13T08:00:00.000Z',
      sourceUrl: 'https://example.com/jobs/1',
      mustHaveLanguages: ['Engelska'],
    },
    {
      id: 'fictional-2',
      title: 'Backend Developer',
      company: 'North Example AB',
      location: 'Luleå',
      region: 'Norrbotten',
      publishedAt: null,
      sourceUrl: 'https://example.com/jobs/2',
      mustHaveLanguages: [],
    },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe('public job view', () => {
  it('loads validated jobs and filters by region', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(feed))),
    );
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText('Software Engineer')).toBeTruthy();
    expect(screen.getByText('Backend Developer')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Region'), 'Stockholm');
    expect(screen.queryByText('Backend Developer')).toBeNull();
  });

  it('shows an error state when the published shape is invalid', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ...feed,
              jobs: [{ ...feed.jobs[0], sourceUrl: 'javascript:bad' }],
            }),
          ),
      ),
    );
    render(<App />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });
});
