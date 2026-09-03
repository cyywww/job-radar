import { errorResponseSchema } from '@job-radar/shared';

export async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has('accept')) headers.set('accept', 'application/json');
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    const body = errorResponseSchema.safeParse(await response.json().catch(() => null));
    throw new Error(
      body.success
        ? body.data.error.message
        : `Request failed with HTTP ${response.status}`,
    );
  }
  return response;
}

export async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  return (await request(path, init)).json();
}
