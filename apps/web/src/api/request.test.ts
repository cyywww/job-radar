import { afterEach, describe, expect, it, vi } from 'vitest';
import { request, requestJson } from './request.js';

afterEach(() => vi.unstubAllGlobals());

describe('shared HTTP client', () => {
  it('sets JSON headers and forwards cancellation', async () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}'));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    await expect(
      requestJson('/api/example', {
        method: 'POST',
        body: '{}',
        signal: controller.signal,
      }),
    ).resolves.toEqual({ ok: true });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get('accept')).toBe('application/json');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(init.signal).toBe(controller.signal);
  });

  it('preserves raw upload headers and handles empty delete responses', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await request('/api/profiles/import/file', {
      method: 'POST',
      body: 'Fictional profile',
      headers: new Headers({
        'content-type': 'text/plain',
        'x-file-name': 'fictional.txt',
      }),
    });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get('content-type')).toBe('text/plain');
    expect(new Headers(init.headers).get('x-file-name')).toBe('fictional.txt');
    expect(response.status).toBe(204);
  });

  it('surfaces validated API errors and rejects malformed error bodies safely', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: {
                code: 'CONFLICT',
                message: 'Reload this profile.',
                requestId: 'test',
              },
            }),
            { status: 409 },
          ),
        )
        .mockResolvedValueOnce(new Response('<html>Unavailable</html>', { status: 503 })),
    );
    await expect(requestJson('/api/profiles')).rejects.toThrow('Reload this profile.');
    await expect(requestJson('/api/profiles')).rejects.toThrow('HTTP 503');
  });
});
