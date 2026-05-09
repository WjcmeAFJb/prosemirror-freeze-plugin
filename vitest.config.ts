import { defineConfig } from 'vitest/config';

// Single config: include both unit and e2e files. Specific runs use
// `--include` patterns from the package.json scripts to scope to one or the
// other. The browser environment is opt-in via VITEST_BROWSER=1 to avoid
// requiring playwright on every CI run.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'e2e/**/*.test.ts'],
    environment: 'node',
    globals: false,
    ...(process.env['VITEST_BROWSER']
      ? {
          include: ['e2e/**/*.test.ts'],
          browser: {
            enabled: true,
            name: 'chromium',
            provider: 'playwright',
            headless: true,
          },
        }
      : {
          include: ['tests/**/*.test.ts'],
        }),
  },
});
