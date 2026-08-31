const trackingParameters = new Set([
  'dclid',
  'fbclid',
  'gclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  'msclkid',
  'referrer',
  'referrer_id',
  'trk',
]);

function decodeUnreserved(pathname: string): string {
  return pathname.replace(/%[0-9a-f]{2}/gi, (encoded) => {
    const character = String.fromCharCode(Number.parseInt(encoded.slice(1), 16));
    return /[A-Za-z0-9._~-]/.test(character) ? character : encoded.toUpperCase();
  });
}

export function canonicalizeJobUrl(value: string): string {
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new TypeError('Job URLs must use HTTP or HTTPS');
  }
  url.username = '';
  url.password = '';
  url.hash = '';
  url.hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    (url.protocol === 'https:' && url.port === '443') ||
    (url.protocol === 'http:' && url.port === '80')
  ) {
    url.port = '';
  }
  url.pathname = decodeUnreserved(url.pathname.replace(/\/{2,}/g, '/'));
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
  for (const key of [...url.searchParams.keys()]) {
    if (
      key.toLowerCase().startsWith('utm_') ||
      trackingParameters.has(key.toLowerCase())
    ) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  return url.toString();
}

export function normalizeIdentityText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeDescription(value: string): string {
  return normalizeIdentityText(value)
    .replace(/\s*([,.;:!?()])\s*/g, '$1')
    .trim();
}

export function publishedDateKey(value: string | Date | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export function compositeJobIdentity(input: {
  company: string;
  title: string;
  location: string;
  publishedAt: string | Date | null;
}): string | null {
  const published = publishedDateKey(input.publishedAt);
  if (!published) return null;
  return [
    normalizeIdentityText(input.company),
    normalizeIdentityText(input.title),
    normalizeIdentityText(input.location),
    published,
  ].join('|');
}
