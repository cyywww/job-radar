import { ConnectorCancelledError } from './contracts.js';

export async function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new ConnectorCancelledError();
  if (ms <= 0) return;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ConnectorCancelledError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function canonicalizeUrl(value: string): string {
  const url = new URL(value);
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_.+|fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString();
}

export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  signal: AbortSignal,
  worker: (value: T) => Promise<R>,
): Promise<Array<PromiseSettledResult<R>>> {
  const results = new Array<PromiseSettledResult<R>>(values.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < values.length) {
      if (signal.aborted) throw new ConnectorCancelledError();
      const index = nextIndex++;
      const value = values[index];
      if (value === undefined) continue;
      try {
        results[index] = { status: 'fulfilled', value: await worker(value) };
      } catch (error) {
        results[index] = { status: 'rejected', reason: error };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => runWorker()),
  );
  return results;
}
