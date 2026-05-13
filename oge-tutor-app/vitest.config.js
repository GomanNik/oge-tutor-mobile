/*
 * OGE Tutor App — Vitest configuration for domain/API contract tests.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.js'],
  },
});
