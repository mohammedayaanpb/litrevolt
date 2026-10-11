import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Keep local diagnostics and temporary files outside the automated suite.
    include: ['tests/**/*.test.ts'],
  },
});
