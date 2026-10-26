import { afterEach, describe, expect, it, vi } from 'vitest';
import { LegacyRetirementGuard } from '../src/workspace/legacy-retirement.guard';
import { isLegacyRequestAllowed, legacyReadOnly, parseLegacyApiMode } from '../src/workspace/legacy-mode';
import { PrismaService } from '../src/prisma/prisma.service';
import { validateEnv } from '../src/config/env.validation';

afterEach(() => vi.unstubAllEnvs());
describe('legacy retirement policy', () => {
  it('keeps compatibility as an explicit default and rejects misspelled modes', () => {
    expect(parseLegacyApiMode()).toBe('enabled');
    expect(() => parseLegacyApiMode('readonly')).toThrow();
    expect(() => validateEnv({ DATABASE_URL: 'postgresql://localhost/test', LEGACY_API_MODE: 'disabled' })).toThrow('LEGACY_CUTOVER_CONFIRM');
  });
  it('blocks all legacy routes when disabled, including public login and downloads', () => {
    for (const route of ['/auth/login', '/auth/password-reset', '/bootstrap', '/students/a', '/lessons/a/complete', '/homeworks/a', '/files/a/download', '/materials', '/notifications/read-all']) {
      expect(isLegacyRequestAllowed(route, 'GET', 'disabled')).toBe(false);
      expect(isLegacyRequestAllowed(route, 'POST', 'disabled')).toBe(false);
    }
    for (const route of ['/health', '/health/ready', '/internal/metrics', '/api/docs', '/api/v2/auth/login', '/api/v2/runtime']) expect(isLegacyRequestAllowed(route, 'POST', 'disabled')).toBe(true);
  });
  it('keeps account security in read-only mode without allowing academic mutations', () => {
    expect(isLegacyRequestAllowed('/auth/login', 'POST', 'read_only')).toBe(true);
    expect(isLegacyRequestAllowed('/lessons/a', 'GET', 'read_only')).toBe(true);
    expect(isLegacyRequestAllowed('/lessons/a', 'PATCH', 'read_only')).toBe(false);
    expect(isLegacyRequestAllowed('/files', 'POST', 'read_only')).toBe(false);
  });
  it('makes imported resources editable only after old writers are disabled', () => {
    for (const [mode, expected] of [['enabled', true], ['read_only', true], ['disabled', false]] as const) {
      vi.stubEnv('LEGACY_API_MODE', mode);
      expect(legacyReadOnly('legacy-id')).toBe(expected);
      expect(legacyReadOnly(null)).toBe(false);
    }
  });
  it('persists a cutover barrier and refuses configuration-only rollback', async () => {
    const barrier = { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({}) };
    const guard = new LegacyRetirementGuard({ legacyCutover: barrier } as unknown as PrismaService);
    vi.stubEnv('LEGACY_API_MODE', 'disabled');
    await guard.onModuleInit();
    expect(barrier.upsert).toHaveBeenCalledTimes(1);
    barrier.findUnique.mockResolvedValue({ id: 'v2-authoritative' });
    vi.stubEnv('LEGACY_API_MODE', 'enabled');
    await expect(guard.onModuleInit()).rejects.toThrow('verified restore');
    vi.stubEnv('LEGACY_API_MODE', 'read_only');
    await expect(guard.onModuleInit()).rejects.toThrow('verified restore');
  });
});
