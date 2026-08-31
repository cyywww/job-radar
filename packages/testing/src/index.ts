import { defineConfig, mergeConfig, type ViteUserConfig } from 'vitest/config';

export { createFictionalProfileInput } from './profile-fixture.js';

export function defineJobRadarTestConfig(config: ViteUserConfig = {}): ViteUserConfig {
  return mergeConfig(
    defineConfig({
      test: {
        clearMocks: true,
        coverage: {
          provider: 'v8',
          reporter: ['text', 'html'],
        },
        exclude: ['**/node_modules/**', '**/dist/**', '**/coverage/**'],
        passWithNoTests: false,
        reporters: ['default'],
      },
    }),
    defineConfig(config),
  );
}
