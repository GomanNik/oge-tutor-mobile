import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { writeFile } from 'node:fs/promises';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { validateEnv } from '../config/env.validation';
import { ReleaseVerificationService } from '../release/release-verification.service';

@Module({ imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }), PrismaModule], providers: [ReleaseVerificationService] })
class ReleaseToolsModule {}
async function main() {
  const command = process.argv[2];
  const option = (name: string) => { const index = process.argv.indexOf(`--${name}`); return index < 0 ? '' : process.argv[index + 1] || ''; };
  if (!['verify', 'retire-legacy-invites', 'adopt-file-checksums'].includes(command)) throw new Error('Usage: release:operator verify [--workspace ID] [--output PATH] | retire-legacy-invites|adopt-file-checksums --workspace ID --reason TEXT --confirm apply');
  const app = await NestFactory.createApplicationContext(ReleaseToolsModule, { logger: ['error', 'warn'] });
  try {
    const service = app.get(ReleaseVerificationService), prisma = app.get(PrismaService);
    const workspaceId = option('workspace');
    if (command !== 'verify') {
      if (!workspaceId || option('confirm') !== 'apply') throw new Error('Mutations require --workspace ID --reason TEXT --confirm apply.');
      const result = command === 'retire-legacy-invites' ? await service.retireLegacyInvites(workspaceId, option('reason')) : await service.adoptFileChecksums(workspaceId, option('reason'));
      process.stdout.write(`${JSON.stringify({ command, ...result })}\n`);
      return;
    }
    const reports = [];
    let cursor: string | undefined;
    for (;;) {
      const rows = await prisma.workspace.findMany({ where: workspaceId ? { id: workspaceId } : {}, orderBy: { id: 'asc' }, take: 25, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true } });
      if (!rows.length) break;
      for (const row of rows) reports.push({ ...await service.report(row.id), fileVerification: await service.verifyFiles(row.id) });
      cursor = rows[rows.length - 1].id;
    }
    if (workspaceId && !reports.length) throw new Error('Workspace not found.');
    const orphaned = await prisma.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) FROM "TeacherProfile" t WHERE NOT EXISTS (SELECT 1 FROM "LegacyWorkspaceMapping" m WHERE m."teacherProfileId"=t.id)`;
    const report = { generatedAt: new Date(), snapshotOnly: true, orphanedLegacyTeachers: Number(orphaned[0].count),
      ready: reports.every(r => r.readyForCutover && r.fileVerification.ok) && Number(orphaned[0].count) === 0, workspaces: reports };
    const output = `${JSON.stringify(report, null, 2)}\n`;
    if (option('output')) await writeFile(option('output'), output, { flag: 'wx' });
    process.stdout.write(output);
    if (!report.ready) process.exitCode = 2;
  } finally { await app.close(); }
}
void main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : 'Release verification failed'}\n`); process.exitCode = 1; });
