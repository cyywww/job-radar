import { join } from 'node:path';

import pino, { type Logger } from 'pino';

import type { AppConfig } from './environment.js';

const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'request.headers.authorization',
  'request.headers.cookie',
  'req.body',
  'request.body',
  'body',
  '*.password',
  '*.token',
  '*.apiKey',
  '*.profile',
  '*.resume',
  '*.text',
  '*.content',
  '*.evidenceExcerpt',
  '*.descriptionText',
  '*.descriptionHtml',
  '*.rawJson',
];

export function createLogger(config: AppConfig, service: string): Logger {
  const fileDestination = pino.destination({
    dest: join(config.logDir, `${service}.log`),
    mkdir: true,
    sync: false,
  });

  return pino(
    {
      base: { service },
      level: config.logLevel,
      redact: {
        paths: REDACTED_PATHS,
        censor: '[REDACTED]',
      },
    },
    pino.multistream([{ stream: process.stdout }, { stream: fileDestination }]),
  );
}
