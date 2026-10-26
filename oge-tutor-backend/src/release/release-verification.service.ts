import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { forbidden, notFound, validationError } from '../common/app-error';
import { WorkspaceContext } from '../workspace/workspace-context.service';
import { legacyApiMode } from '../workspace/legacy-mode';

export const releaseFileScope = (workspaceId: string): Prisma.FileResourceWhereInput => ({ OR: [
  { workspaceId },
  { workspaceId: null, owner: { OR: [{ teacherProfile: { legacyWorkspace: { workspaceId } } }, { studentProfile: { teacher: { legacyWorkspace: { workspaceId } } } }] } },
] });

@Injectable()
export class ReleaseVerificationService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}
  async report(workspaceId: string, ctx?: WorkspaceContext) {
    return this.prisma.$transaction(async tx => {
      if (ctx) {
        if (ctx.role !== 'admin' || ctx.workspaceId !== workspaceId) throw forbidden();
        const member = await tx.workspaceMembership.findUnique({ where: { workspaceId_userId: { workspaceId, userId: ctx.userId } }, include: { workspace: true, roles: true } });
        if (member?.status !== 'active' || member.workspace.status !== 'active' || !member.roles.some(r => r.role === 'admin' && !r.revokedAt)) throw forbidden();
      }
      if (!await tx.workspace.count({ where: { id: workspaceId } })) throw notFound();
      const count = async (sql: Prisma.Sql) => Number((await tx.$queryRaw<{ count: bigint }[]>(sql))[0].count);
      const checks: { code: string; count: number; passed: boolean }[] = [];
      const check = async (code: string, sql: Prisma.Sql) => { const value = await count(sql); checks.push({ code, count: value, passed: value === 0 }); };
      await check('student_mapping', Prisma.sql`SELECT COUNT(*) FROM "StudentProfile" s JOIN "LegacyWorkspaceMapping" w ON w."teacherProfileId"=s."teacherId"
        LEFT JOIN "LegacyCourseMapping" m ON m."studentProfileId"=s.id LEFT JOIN "Course" c ON c.id=m."courseId"
        LEFT JOIN "Enrollment" e ON e.id=m."enrollmentId" LEFT JOIN "WorkspaceMembership" member ON member.id=e."membershipId"
        WHERE w."workspaceId"=${workspaceId} AND (m."courseId" IS NULL OR c."workspaceId"<>w."workspaceId" OR e."courseId"<>c.id OR member."userId"<>s."userId")`);
      await check('lesson_roster', Prisma.sql`SELECT COUNT(*) FROM "Lesson" l JOIN "LegacyWorkspaceMapping" w ON w."teacherProfileId"=l."teacherId"
        LEFT JOIN "LegacyCourseMapping" m ON m."studentProfileId"=l."studentId" WHERE w."workspaceId"=${workspaceId}
        AND (l."courseId"<>m."courseId" OR NOT EXISTS (SELECT 1 FROM "LessonParticipant" p WHERE p."lessonId"=l.id AND p."enrollmentId"=m."enrollmentId")
        OR NOT EXISTS (SELECT 1 FROM "LessonTeacher" t WHERE t."lessonId"=l.id AND t."courseId"=l."courseId"))`);
      await check('assignment_recipients', Prisma.sql`SELECT COUNT(*) FROM "Homework" h JOIN "LegacyWorkspaceMapping" w ON w."teacherProfileId"=h."teacherId"
        LEFT JOIN "LegacyCourseMapping" m ON m."studentProfileId"=h."studentId" LEFT JOIN "Assignment" a ON a."legacyHomeworkId"=h.id
        WHERE w."workspaceId"=${workspaceId} AND (a.id IS NULL OR a."courseId"<>m."courseId" OR NOT EXISTS (SELECT 1 FROM "AssignmentRecipient" r WHERE r."assignmentId"=a.id AND r."enrollmentId"=m."enrollmentId"))`);
      await check('submission_files', Prisma.sql`SELECT COUNT(*) FROM "HomeworkSubmission" s JOIN "Homework" h ON h.id=s."homeworkId" JOIN "LegacyWorkspaceMapping" w ON w."teacherProfileId"=h."teacherId"
        LEFT JOIN "AssignmentSubmission" mirror ON mirror."legacySubmissionId"=s.id WHERE w."workspaceId"=${workspaceId}
        AND (mirror.id IS NULL OR NOT EXISTS (SELECT 1 FROM "AssignmentSubmissionFile" f WHERE f."submissionId"=mirror.id AND f."fileId"=s."fileResourceId"))`);
      await check('material_sources', Prisma.sql`SELECT COUNT(*) FROM "MaterialAttachment" a JOIN "MaterialTopic" t ON t.id=a."topicId" JOIN "LegacyWorkspaceMapping" w ON w."teacherProfileId"=t."teacherId"
        LEFT JOIN "LearningMaterial" m ON m."legacyAttachmentId"=a.id WHERE w."workspaceId"=${workspaceId} AND (m.id IS NULL OR m."workspaceId"<>w."workspaceId" OR (${legacyApiMode() !== 'disabled'} AND m."fileId" IS DISTINCT FROM a."fileId"))`);
      await check('progress_history', Prisma.sql`SELECT COUNT(*) FROM "ProgressHistory" h JOIN "StudentProfile" s ON s.id=h."studentId" JOIN "LegacyWorkspaceMapping" w ON w."teacherProfileId"=s."teacherId"
        JOIN "LegacyCourseMapping" m ON m."studentProfileId"=s.id WHERE w."workspaceId"=${workspaceId}
        AND NOT EXISTS (SELECT 1 FROM "LearningProgressEvent" e WHERE e."sourceKey"='legacy-history:'||h.id AND e."enrollmentId"=m."enrollmentId")`);
      await check('progress_snapshots', Prisma.sql`SELECT COUNT(*) FROM "StudentTaskProgress" p JOIN "StudentProfile" s ON s.id=p."studentId" JOIN "LegacyWorkspaceMapping" w ON w."teacherProfileId"=s."teacherId"
        JOIN "LegacyCourseMapping" m ON m."studentProfileId"=s.id WHERE w."workspaceId"=${workspaceId}
        AND NOT EXISTS (SELECT 1 FROM "LearningProgressEvent" e WHERE e."sourceKey"='legacy-snapshot:'||p.id||':'||md5(to_jsonb(p)::TEXT) AND e."enrollmentId"=m."enrollmentId")`);
      await check('notification_recipients', Prisma.sql`SELECT COUNT(*) FROM "Notification" n JOIN "LegacyWorkspaceMapping" w ON w."teacherProfileId"=n."teacherId" JOIN "TeacherProfile" t ON t.id=n."teacherId"
        WHERE w."workspaceId"=${workspaceId} AND NOT EXISTS (SELECT 1 FROM "LearningNotification" m WHERE m."legacyNotificationId"=n.id AND m."workspaceId"=w."workspaceId" AND m."recipientUserId"=t."userId" AND m."recipientRole"='teacher')`);
      await check('pending_legacy_invites', Prisma.sql`SELECT COUNT(*) FROM "AccessToken" a JOIN "StudentProfile" s ON s."userId"=a."userId" JOIN "LegacyWorkspaceMapping" w ON w."teacherProfileId"=s."teacherId"
        WHERE w."workspaceId"=${workspaceId} AND a.type='invite' AND a."usedAt" IS NULL AND a."expiresAt">NOW()`);
      await check('progress_projection', Prisma.sql`WITH effective AS (
        SELECT DISTINCT ON (e."enrollmentId",e."taskDefinitionId") e."enrollmentId",e."taskDefinitionId",e.id FROM "LearningProgressEvent" e JOIN "Enrollment" n ON n.id=e."enrollmentId"
        WHERE n."workspaceId"=${workspaceId} AND e.visibility='published' AND e.kind<>'retraction' AND e."taskDefinitionId" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "LearningProgressEvent" child WHERE child."supersedesId"=e.id AND child.visibility='published')
        ORDER BY e."enrollmentId",e."taskDefinitionId",e."occurredAt" DESC,e."recordedAt" DESC,e.id DESC
      ), actual AS (SELECT p.* FROM "LearningProgressProjection" p JOIN "Enrollment" n ON n.id=p."enrollmentId" WHERE n."workspaceId"=${workspaceId})
        SELECT COUNT(*) FROM effective e FULL JOIN actual p ON p."enrollmentId"=e."enrollmentId" AND p."taskDefinitionId"=e."taskDefinitionId" WHERE e.id IS DISTINCT FROM p."eventId"`);
      await check('live_migration_failures', Prisma.sql`SELECT COUNT(*) FROM "LessonSeries" s JOIN "Course" c ON c.id=s."courseId" WHERE c."workspaceId"=${workspaceId} AND s.failures>0`);
      const [courses, lessons, assignments, submissions, progressEvents, notifications, files, cutover] = await Promise.all([
        tx.course.count({ where: { workspaceId } }), tx.lesson.count({ where: { course: { workspaceId } } }), tx.assignment.count({ where: { course: { workspaceId } } }),
        tx.assignmentSubmission.count({ where: { recipient: { enrollment: { workspaceId } } } }), tx.learningProgressEvent.count({ where: { enrollment: { workspaceId } } }),
        tx.learningNotification.count({ where: { workspaceId } }), tx.fileResource.count({ where: releaseFileScope(workspaceId) }), tx.legacyCutover.findUnique({ where: { id: 'v2-authoritative' } }),
      ]);
      return { workspaceId, asOf: new Date(), legacyApiMode: legacyApiMode(), cutoverCommittedAt: cutover?.cutoverAt || null,
        dataConsistent: checks.every(c => c.passed), readyForCutover: legacyApiMode() !== 'enabled' && checks.every(c => c.passed),
        counts: { courses, lessons, assignments, submissions, progressEvents, notifications, files }, checks, requiresFileVerification: true, requiresVerifiedRestore: true };
    }, { isolationLevel: 'RepeatableRead', timeout: 60000 });
  }

  async verifyFiles(workspaceId: string, includeBaseline = false) {
    const root = path.resolve(this.config.get<string>('UPLOAD_DIR') || 'uploads');
    const issues: { id: string; code: string }[] = [];
    const baselines: { id: string; checksum: string; size: number; storagePath: string }[] = [];
    const manifest = createHash('sha256');
    let cursor: string | undefined;
    let verified = 0;
    for (;;) {
      const rows = await this.prisma.fileResource.findMany({ where: releaseFileScope(workspaceId), orderBy: { id: 'asc' }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, storagePath: true, checksum: true, size: true } });
      if (!rows.length) break;
      for (const file of rows) {
        try {
          const [realRoot, location] = await Promise.all([realpath(root), realpath(file.storagePath)]);
          const relative = path.relative(realRoot, location);
          if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) { issues.push({ id: file.id, code: 'outside_upload_root' }); continue; }
          const info = await stat(location);
          if (!info.isFile() || info.size !== file.size) { issues.push({ id: file.id, code: 'size_mismatch' }); continue; }
          const hash = createHash('sha256');
          for await (const chunk of createReadStream(location)) hash.update(chunk);
          const checksum = hash.digest('hex');
          manifest.update(JSON.stringify({ id: file.id, size: file.size, checksum }));
          if (file.checksum && file.checksum !== checksum) { issues.push({ id: file.id, code: 'checksum_mismatch' }); continue; }
          if (!file.checksum) {
            issues.push({ id: file.id, code: 'checksum_unrecorded' });
            if (includeBaseline) {
              if (baselines.length >= 5000) { issues.push({ id: file.id, code: 'baseline_limit_exceeded' }); continue; }
              baselines.push({ id: file.id, checksum, size: file.size, storagePath: file.storagePath });
            }
            continue;
          }
          verified++;
        } catch { issues.push({ id: file.id, code: 'missing_or_unreadable' }); }
      }
      cursor = rows[rows.length - 1].id;
    }
    return { verified, issues, manifestSha256: manifest.digest('hex'), ok: !issues.length, ...(includeBaseline ? { baselines } : {}) };
  }

  async adoptFileChecksums(workspaceId: string, reason: string) {
    if (legacyApiMode() !== 'read_only' || reason.trim().length < 10) throw validationError('Нужны режим read_only и причина от 10 символов.');
    const report = await this.verifyFiles(workspaceId, true);
    if (report.issues.some(issue => issue.code !== 'checksum_unrecorded')) throw validationError('Сначала устраните повреждённые и недоступные файлы.');
    const baselines = report.baselines || [];
    await this.prisma.$transaction(async tx => {
      for (const file of baselines) {
        const changed = await tx.fileResource.updateMany({ where: { id: file.id, checksum: null, size: file.size, storagePath: file.storagePath }, data: { checksum: file.checksum } });
        if (changed.count !== 1) throw validationError('Инвентаризация изменилась. Повторите сверку.');
      }
      await tx.workspaceAuditEvent.create({ data: { workspaceId, actorKind: 'operator', targetType: 'legacy_cutover', targetId: workspaceId, action: 'legacy.file_checksums_adopted',
        changes: { count: baselines.length, manifestSha256: report.manifestSha256 }, reason: reason.trim(), requestId: randomUUID() } });
    }, { isolationLevel: 'Serializable', timeout: 60000 });
    return { adoptedCount: baselines.length, manifestSha256: report.manifestSha256 };
  }

  async retireLegacyInvites(workspaceId: string, reason: string) {
    if (legacyApiMode() !== 'read_only' || reason.trim().length < 10) throw validationError('Нужны LEGACY_API_MODE=read_only и причина от 10 символов.');
    return this.prisma.$transaction(async tx => {
      const tokens = await tx.accessToken.findMany({ where: { type: 'invite', usedAt: null, expiresAt: { gt: new Date() }, user: { studentProfile: { teacher: { legacyWorkspace: { workspaceId } } } } }, include: { user: true } });
      for (const token of tokens) {
        if (!await tx.workspaceInvitation.count({ where: { workspaceId, email: token.user.email, status: 'pending', expiresAt: { gt: new Date() }, roles: { some: { role: 'student' } } } })) throw validationError('Сначала создайте замещающие приглашения v2 для каждого получателя.');
      }
      await tx.accessToken.updateMany({ where: { id: { in: tokens.map(t => t.id) }, usedAt: null }, data: { usedAt: new Date() } });
      await tx.workspaceAuditEvent.create({ data: { workspaceId, actorKind: 'operator', targetType: 'legacy_cutover', targetId: workspaceId, action: 'legacy.invites_retired', changes: { count: tokens.length }, reason: reason.trim(), requestId: randomUUID() } });
      return { retiredCount: tokens.length };
    }, { isolationLevel: 'Serializable' });
  }
}
