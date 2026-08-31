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

const namedEntities: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  hellip: '…',
  lt: '<',
  nbsp: ' ',
  ndash: '–',
  quot: '"',
  rsquo: '’',
};

export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#(?:x[0-9a-f]+|[0-9]+)|[a-z]+);/gi, (entity, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    }
    if (code.startsWith('#'))
      return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
    return namedEntities[code.toLowerCase()] ?? entity;
  });
}

export function htmlToText(value: string): string {
  let text = '';
  let insideTag = false;
  let tag = '';
  for (const character of value) {
    if (character === '<' && !insideTag) {
      insideTag = true;
      tag = '';
      continue;
    }
    if (character === '>' && insideTag) {
      insideTag = false;
      const name = tag.trim().replace(/^\//, '').split(/[\s/]/, 1)[0]?.toLowerCase();
      if (
        name &&
        ['br', 'div', 'h1', 'h2', 'h3', 'h4', 'li', 'p', 'section', 'tr'].includes(name)
      ) {
        text += '\n';
      }
      continue;
    }
    if (insideTag) tag += character;
    else text += character;
  }
  return decodeHtmlEntities(text)
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function parseOptionalDate(
  value: string | number | null | undefined,
): string | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
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
