import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { ReleaseVerificationService } from '../src/release/release-verification.service';

const directories: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function fixture(options: { missing?: boolean; outside?: boolean; size?: number; checksum?: string | null } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'release-file-test-'));
  directories.push(root);
  const content = Buffer.from('release fixture content');
  const location = options.outside ? path.join(await mkdtemp(path.join(os.tmpdir(), 'release-outside-test-')), 'fixture.txt') : path.join(root, 'fixture.txt');
  if (options.outside) directories.push(path.dirname(location));
  if (!options.missing) await writeFile(location, content);
  const row = { id: 'file', storagePath: location, size: options.size ?? content.length, checksum: options.checksum === undefined ? createHash('sha256').update(content).digest('hex') : options.checksum };
  const findMany = vi.fn().mockResolvedValueOnce([row]).mockResolvedValue([]);
  return { row, service: new ReleaseVerificationService({ fileResource: { findMany } } as unknown as PrismaService, new ConfigService({ UPLOAD_DIR: root })) };
}
describe('release file verification', () => {
  it('verifies bytes, size and SHA-256 without changing metadata', async () => {
    const { service } = await fixture();
    await expect(service.verifyFiles('workspace')).resolves.toMatchObject({ ok: true, verified: 1, issues: [] });
  });
  it('rejects missing files and paths outside the configured upload root', async () => {
    const missing = await fixture({ missing: true }), outside = await fixture({ outside: true });
    expect((await missing.service.verifyFiles('workspace')).issues).toEqual([{ id: 'file', code: 'missing_or_unreadable' }]);
    expect((await outside.service.verifyFiles('workspace')).issues).toEqual([{ id: 'file', code: 'outside_upload_root' }]);
  });
  it('does not accept matching names or sizes in place of a matching checksum', async () => {
    const corrupt = await fixture({ checksum: '0'.repeat(64) }), wrongSize = await fixture({ size: 1 });
    expect((await corrupt.service.verifyFiles('workspace')).issues[0].code).toBe('checksum_mismatch');
    expect((await wrongSize.service.verifyFiles('workspace')).issues[0].code).toBe('size_mismatch');
  });
  it('requires an explicit audited baseline operation for legacy files without checksums', async () => {
    const { service } = await fixture({ checksum: null });
    await expect(service.verifyFiles('workspace')).resolves.toMatchObject({ ok: false, verified: 0, issues: [{ id: 'file', code: 'checksum_unrecorded' }] });
  });
  it('adopts only previously absent checksums and records an operator manifest', async () => {
    vi.stubEnv('LEGACY_API_MODE', 'read_only');
    const { service, row } = await fixture({ checksum: null });
    const baseline = await service.verifyFiles('workspace', true);
    expect(baseline.baselines).toEqual([expect.objectContaining({ id: row.id, checksum: expect.stringMatching(/^[a-f0-9]{64}$/) })]);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 }), create = vi.fn().mockResolvedValue({});
    const tx = { fileResource: { updateMany }, workspaceAuditEvent: { create } };
    Object.assign(service, { prisma: { ...tx, $transaction: (callback: (value: typeof tx) => unknown) => callback(tx) } });
    vi.spyOn(service, 'verifyFiles').mockResolvedValue(baseline);
    await expect(service.adoptFileChecksums('workspace', 'Контрольный снимок до перехода')).resolves.toEqual({ adoptedCount: 1, manifestSha256: baseline.manifestSha256 });
    expect(updateMany).toHaveBeenCalledWith({ where: { id: row.id, checksum: null, size: row.size, storagePath: row.storagePath }, data: { checksum: baseline.baselines![0].checksum } });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actorKind: 'operator', action: 'legacy.file_checksums_adopted' }) }));
  });
  it('refuses baseline writes outside read-only mode and refuses damaged content', async () => {
    const { service } = await fixture({ checksum: 'f'.repeat(64) });
    vi.stubEnv('LEGACY_API_MODE', 'enabled');
    await expect(service.adoptFileChecksums('workspace', 'Контрольный снимок до перехода')).rejects.toMatchObject({ status: 422 });
    vi.stubEnv('LEGACY_API_MODE', 'read_only');
    await expect(service.adoptFileChecksums('workspace', 'Контрольный снимок до перехода')).rejects.toMatchObject({ status: 422 });
  });
  it('requires replacement v2 invitations before retiring legacy invite tokens', async () => {
    vi.stubEnv('LEGACY_API_MODE', 'read_only');
    const updateMany = vi.fn().mockResolvedValue({ count: 1 }), audit = vi.fn().mockResolvedValue({});
    const count = vi.fn().mockResolvedValue(0);
    const tx = { accessToken: { findMany: vi.fn().mockResolvedValue([{ id: 'old-invite', user: { email: 'student@test.local' } }]), updateMany }, workspaceInvitation: { count }, workspaceAuditEvent: { create: audit } };
    const service = new ReleaseVerificationService({ $transaction: (callback: (value: typeof tx) => unknown) => callback(tx) } as unknown as PrismaService, new ConfigService());
    await expect(service.retireLegacyInvites('workspace', 'Заменены ссылки на приглашения v2')).rejects.toMatchObject({ status: 422 });
    expect(updateMany).not.toHaveBeenCalled();
    count.mockResolvedValue(1);
    await expect(service.retireLegacyInvites('workspace', 'Заменены ссылки на приглашения v2')).resolves.toEqual({ retiredCount: 1 });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['old-invite'] }, usedAt: null } }));
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actorKind: 'operator', action: 'legacy.invites_retired' }) }));
  });
});
