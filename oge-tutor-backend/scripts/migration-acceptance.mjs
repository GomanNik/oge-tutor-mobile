import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const require = createRequire(import.meta.url);
const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrations = path.join(backend, 'prisma', 'migrations');
const baselineLast = '20261021090000_add_auth_sessions';
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !/(test|e2e|ci)/i.test(databaseUrl)) {
  throw new Error('DATABASE_URL must identify a disposable test/e2e/ci database.');
}
const name = `oge_accept_ci_${randomBytes(6).toString('hex')}`;
const url = new URL(databaseUrl);
url.pathname = `/${name}`;
url.searchParams.set('schema', 'public');
const isolatedUrl = url.toString();
const temporary = mkdtempSync(path.join(os.tmpdir(), 'oge-tutor-migrations-'));
const temporaryMigrations = path.join(temporary, 'migrations');
const schema = path.join(temporary, 'schema.prisma');
const prismaCli = path.join(path.dirname(require.resolve('prisma/package.json')), 'build', 'index.js');
const tsNodeCli = path.join(path.dirname(require.resolve('ts-node/package.json')), 'dist', 'bin.js');
const admin = new PrismaClient();
let db;

function run(args, expectedSuccess = true, overrides = {}) {
  try {
    const output = execFileSync(process.execPath, args, {
      cwd: backend,
      env: { ...process.env, DATABASE_URL: isolatedUrl, ...overrides },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (!expectedSuccess) throw new Error(`Command unexpectedly succeeded: ${args.join(' ')}`);
    return output;
  } catch (error) {
    if (!expectedSuccess && error.status !== undefined) return `${error.stdout || ''}${error.stderr || ''}`;
    throw error;
  }
}

function deploy() {
  return run([prismaCli, 'migrate', 'deploy', '--schema', schema]);
}

function backfill(expectedSuccess = true) {
  return run([tsNodeCli, '--project', 'tsconfig.json', 'src/cli/workspace-operator.ts', 'backfill'], expectedSuccess);
}

async function rows(sql) {
  return db.$queryRawUnsafe(sql);
}

async function count(table) {
  const result = await rows(`SELECT COUNT(*)::int AS count FROM "${table}"`);
  return result[0].count;
}

try {
  cpSync(path.join(backend, 'prisma', 'schema.prisma'), schema);
  mkdirSync(temporaryMigrations);
  cpSync(path.join(migrations, 'migration_lock.toml'), path.join(temporaryMigrations, 'migration_lock.toml'));
  const versions = readdirSync(migrations).filter(entry => /^\d/.test(entry)).sort();
  assert(versions.includes(baselineLast));
  for (const version of versions.filter(entry => entry <= baselineLast)) {
    cpSync(path.join(migrations, version), path.join(temporaryMigrations, version), { recursive: true });
  }

  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  db = new PrismaClient({ datasources: { db: { url: isolatedUrl } } });
  assert.match(deploy(), /successfully applied/i);
  assert.equal(await count('User'), 0);

  await db.$executeRawUnsafe(`
    INSERT INTO "User" (id,email,"passwordHash",role,"updatedAt") VALUES
      ('legacy-tu1','legacy-t1@test.local','hash-t1','teacher',NOW()),
      ('legacy-tu2','legacy-t2@test.local','hash-t2','teacher',NOW()),
      ('legacy-su1','legacy-s1@test.local','hash-s1','student',NOW()),
      ('legacy-su2','legacy-s2@test.local','hash-s2','student',NOW())`);
  await db.$executeRawUnsafe(`
    INSERT INTO "TeacherProfile" (id,"userId",name,"updatedAt") VALUES
      ('legacy-t1','legacy-tu1','Teacher One',NOW()),
      ('legacy-t2','legacy-tu2','Teacher Two',NOW())`);
  await db.$executeRawUnsafe(`
    INSERT INTO "StudentProfile" (id,"userId","teacherId",name,access,"updatedAt") VALUES
      ('legacy-s1','legacy-su1','legacy-t1','Student One','active',NOW()),
      ('legacy-s2','legacy-su2','legacy-t2','Student Two','disabled',NOW())`);
  await db.$executeRawUnsafe(`INSERT INTO "AuthSession" (id,"userId",version,"expiresAt") VALUES ('legacy-session','legacy-su1',0,NOW()+INTERVAL '1 day')`);
  await db.$executeRawUnsafe(`
    INSERT INTO "Lesson" (id,"teacherId","studentId",topic,"startAt","endAt",timezone,"durationMinutes","updatedAt")
    VALUES ('legacy-lesson','legacy-t1','legacy-s1','Algebra',NOW()+INTERVAL '1 day',NOW()+INTERVAL '1 day 1 hour','UTC',60,NOW())`);
  await db.$executeRawUnsafe(`INSERT INTO "FileResource" (id,"ownerId",scope,"originalName","mimeType",size,url,"storagePath")
    VALUES ('legacy-file','legacy-su1','private_submission','answer.txt','text/plain',6,'/files/legacy-file','/tmp/legacy-answer.txt')`);
  await db.$executeRawUnsafe(`INSERT INTO "Homework" (id,"teacherId","studentId",title,description,topic,"taskNumbers","dueAt",status,materials,"reviewMaterials","teacherComment","solutionFile","reviewedAt","closedAt","updatedAt")
    VALUES ('legacy-homework','legacy-t1','legacy-s1','Historical assignment','Solve the task','Algebra',ARRAY[1],NOW()+INTERVAL '2 days','reviewed',
      '[]'::jsonb,'[]'::jsonb,'Good work','answer.txt',NOW(),NOW(),NOW())`);
  await db.$executeRawUnsafe(`INSERT INTO "HomeworkSubmission" (id,"homeworkId","studentId","fileResourceId","reviewStatus","reviewedAt","teacherComment")
    VALUES ('legacy-submission','legacy-homework','legacy-s1','legacy-file','reviewed',NOW(),'Good work')`);
  await db.$executeRawUnsafe(`INSERT INTO "MaterialTopic" (id,"teacherId","taskNumber",title,"updatedAt")
    VALUES ('legacy-topic','legacy-t1',1,'Task 1',NOW())`);
  await db.$executeRawUnsafe(`INSERT INTO "MaterialAttachment" (id,"topicId",type,source,title,url)
    VALUES ('legacy-attachment','legacy-topic','link','link','Task 1 notes','https://example.test/notes')`);
  await db.$executeRawUnsafe(`INSERT INTO "StudentTaskProgress" (id,"studentId","taskNumber","coverageStatus","masteryLevel","teacherComment","lastActivityAt","updatedAt")
    VALUES ('legacy-progress','legacy-s1',1,'assessed','good','Private historical note',NOW(),NOW())`);
  await db.$executeRawUnsafe(`INSERT INTO "ProgressHistory" (id,"studentId","taskProgressId","taskNumber",type,source,"coverageStatus","masteryLevel",comment,"createdAt")
    VALUES ('legacy-history','legacy-s1','legacy-progress',1,'manual_update','manual','assessed','medium','Private history comment',NOW()-INTERVAL '1 day')`);
  await db.$executeRawUnsafe(`INSERT INTO "Notification" (id,type,status,"teacherId","studentId","taskNumber",title,message)
    VALUES ('legacy-notification','progress_assessment_required','read','legacy-t1','legacy-s1',1,'Assessment needed','Historical reminder')`);
  const before = await rows('SELECT id,email,"passwordHash",role FROM "User" ORDER BY id');
  const lessonBefore = await rows('SELECT id,"teacherId","studentId",topic FROM "Lesson"');
  const sessionBefore = await rows('SELECT id,"userId",version FROM "AuthSession"');

  for (const version of versions.filter(entry => entry > baselineLast)) {
    cpSync(path.join(migrations, version), path.join(temporaryMigrations, version), { recursive: true });
  }
  assert.match(deploy(), /successfully applied/i);
  assert.match(deploy(), /No pending migrations/i);
  assert.deepEqual(await rows('SELECT id,email,"passwordHash",role FROM "User" ORDER BY id'), before);
  assert.deepEqual(await rows('SELECT id,"teacherId","studentId",topic FROM "Lesson"'), lessonBefore);
  assert.deepEqual(await rows('SELECT id,"userId",version FROM "AuthSession"'), sessionBefore);
  assert.equal(await count('LegacyWorkspaceMapping'), 2);
  assert.equal(await count('WorkspaceMembership'), 4);
  assert.equal(await count('WorkspaceRoleGrant'), 6);
  assert.deepEqual(await rows(`SELECT "workspaceId",status FROM "WorkspaceMembership" WHERE "userId"='legacy-su2'`),
    [{ workspaceId: 'legacy-legacy-t2', status: 'suspended' }]);
  assert.equal(await count('TaskDefinition'), 25);
  assert.equal(await count('Course'), 2);
  assert.equal(await count('CourseTeacher'), 2);
  assert.equal(await count('Enrollment'), 2);
  assert.equal(await count('LegacyCourseMapping'), 2);
  const importedHistory = (await rows(`SELECT "authorUserId",source,comment,"legacyPayload"->>'comment' AS "originalComment" FROM "LearningProgressEvent" WHERE "sourceKey"='legacy-history:legacy-history'`))[0];
  assert.deepEqual(importedHistory, { authorUserId: null, source: 'legacy_unknown', comment: '', originalComment: 'Private history comment' });
  assert.equal((await rows(`SELECT event."masteryLevel" FROM "LearningProgressProjection" projection JOIN "LearningProgressEvent" event ON event.id=projection."eventId" WHERE projection."enrollmentId"='legacy-enrollment-legacy-s1'`))[0].masteryLevel, 'good');
  assert.deepEqual(await rows(`SELECT "recipientUserId","recipientRole",("readAt" IS NOT NULL) AS read FROM "LearningNotification" WHERE "legacyNotificationId"='legacy-notification'`), [{ recipientUserId: 'legacy-tu1', recipientRole: 'teacher', read: true }]);
  assert.equal(await count('LearningDelivery'), 0);
  await db.$executeRawUnsafe(`UPDATE "Notification" SET status='unread' WHERE id='legacy-notification'`);
  assert.equal((await rows(`SELECT "readAt" IS NULL AS unread FROM "LearningNotification" WHERE "legacyNotificationId"='legacy-notification'`))[0].unread, true);
  await db.$executeRawUnsafe(`INSERT INTO "ProgressHistory" (id,"studentId","taskNumber",type,source,"coverageStatus","masteryLevel") VALUES ('after-migration-history','legacy-s1',1,'manual_update','manual','assessed','strong')`);
  assert.equal((await rows(`SELECT event."masteryLevel" FROM "LearningProgressProjection" projection JOIN "LearningProgressEvent" event ON event.id=projection."eventId" WHERE projection."enrollmentId"='legacy-enrollment-legacy-s1'`))[0].masteryLevel, 'strong');
  await db.$executeRawUnsafe(`UPDATE "StudentTaskProgress" SET "masteryLevel"='weak',"lastActivityAt"=NOW()+INTERVAL '1 second',"updatedAt"=NOW() WHERE id='legacy-progress'`);
  await db.$executeRawUnsafe(`DELETE FROM "LearningProgressProjection"`);
  await db.$executeRawUnsafe(`SELECT learning_rebuild_progress()`);
  assert.equal((await rows(`SELECT event."masteryLevel" FROM "LearningProgressProjection" projection JOIN "LearningProgressEvent" event ON event.id=projection."eventId" WHERE projection."enrollmentId"='legacy-enrollment-legacy-s1'`))[0].masteryLevel, 'weak');
  await assert.rejects(db.$executeRawUnsafe(`UPDATE "LearningProgressEvent" SET comment='lost history' WHERE "sourceKey"='legacy-history:legacy-history'`));
  await assert.rejects(db.$executeRawUnsafe(`DELETE FROM "LearningProgressEvent" WHERE "sourceKey"='legacy-history:legacy-history'`));
  assert.equal(await count('LessonTeacher'), 1);
  assert.equal(await count('LessonParticipant'), 1);
  assert.deepEqual(await rows(`SELECT id,"courseId" FROM "Lesson" WHERE id='legacy-lesson'`),
    [{ id: 'legacy-lesson', courseId: 'legacy-course-legacy-s1' }]);
  await db.$executeRawUnsafe(`INSERT INTO "LessonSeries" (id,"courseId",topic,format,"startsAtLocal","untilLocalDate",timezone,frequency,"durationMinutes","operatorUserId","operatorRole","updatedAt")
    VALUES ('migration-series','legacy-course-legacy-s1','Series constraints','individual','2026-11-01T14:00','2026-12-01','UTC','weekly',60,'legacy-tu1','teacher',NOW())`);
  await db.$executeRawUnsafe(`INSERT INTO "LessonSeriesTeacher" ("seriesId","courseId","courseTeacherId") VALUES ('migration-series','legacy-course-legacy-s1','legacy-course-teacher-legacy-s1')`);
  await db.$executeRawUnsafe(`INSERT INTO "LessonSeriesParticipant" ("seriesId","courseId","enrollmentId") VALUES ('migration-series','legacy-course-legacy-s1','legacy-enrollment-legacy-s1')`);
  await assert.rejects(db.$executeRawUnsafe(`INSERT INTO "LessonSeriesTeacher" ("seriesId","courseId","courseTeacherId") VALUES ('migration-series','legacy-course-legacy-s1','legacy-course-teacher-legacy-s2')`));
  await assert.rejects(db.$executeRawUnsafe(`INSERT INTO "LessonSeriesParticipant" ("seriesId","courseId","enrollmentId") VALUES ('migration-series','legacy-course-legacy-s1','legacy-enrollment-legacy-s2')`));
  await assert.rejects(db.$executeRawUnsafe(`UPDATE "LessonSeries" SET interval=0 WHERE id='migration-series'`));
  await assert.rejects(db.$executeRawUnsafe(`UPDATE "LessonSeries" SET "operatorUserId"='missing-user' WHERE id='migration-series'`));
  await assert.rejects(db.$executeRawUnsafe(`UPDATE "LessonSeries" SET "operatorRole"='student' WHERE id='migration-series'`));
  await assert.rejects(db.$executeRawUnsafe(`UPDATE "Lesson" SET "seriesId"='migration-series',"seriesOccurrenceKey"='2026-11-01' WHERE id='legacy-lesson'`));
  await db.$executeRawUnsafe(`UPDATE "Lesson" SET "seriesId"='migration-series',"seriesRevision"=0,"seriesOccurrenceKey"='2026-11-01' WHERE id='legacy-lesson'`);
  await assert.rejects(db.$executeRawUnsafe(`INSERT INTO "Lesson" (id,"courseId",topic,"startAt","endAt",timezone,"durationMinutes","seriesId","seriesRevision","seriesOccurrenceKey","updatedAt")
    VALUES ('duplicate-occurrence','legacy-course-legacy-s1','Duplicate',NOW(),NOW()+INTERVAL '1 hour','UTC',60,'migration-series',0,'2026-11-01',NOW())`));
  await assert.rejects(db.$executeRawUnsafe(`DELETE FROM "LessonSeries" WHERE id='migration-series'`));
  await db.$executeRawUnsafe(`UPDATE "Lesson" SET status='completed',"completedAt"=NOW() WHERE id='legacy-lesson'`);
  await db.$executeRawUnsafe(`SELECT learning_record_lesson('legacy-lesson')`);
  const recordedLessonEvents = (await rows(`SELECT COUNT(*)::int AS count FROM "LearningProgressEvent" WHERE source='lesson' AND evidence->>'lessonId'='legacy-lesson'`))[0].count;
  assert.equal(recordedLessonEvents, 1);
  await db.$executeRawUnsafe(`SELECT learning_record_lesson('legacy-lesson')`);
  assert.equal((await rows(`SELECT COUNT(*)::int AS count FROM "LearningProgressEvent" WHERE source='lesson' AND evidence->>'lessonId'='legacy-lesson'`))[0].count, recordedLessonEvents);
  assert.equal(await count('LegacyCutover'), 0);
  await db.$executeRawUnsafe(`INSERT INTO "LegacyCutover" (id) VALUES ('v2-authoritative')`);
  await assert.rejects(db.$executeRawUnsafe(`INSERT INTO "LegacyCutover" (id) VALUES ('v2-authoritative')`));
  assert.deepEqual(await rows(`SELECT c.id,c.status,e.status AS "enrollmentStatus" FROM "Course" c JOIN "Enrollment" e ON e."courseId"=c.id WHERE c.id='legacy-course-legacy-s1'`),
    [{ id: 'legacy-course-legacy-s1', status: 'active', enrollmentStatus: 'active' }]);
  assert.deepEqual(await rows(`SELECT id,status FROM "ProgramVersion" WHERE id='legacy-version-oge-math'`),
    [{ id: 'legacy-version-oge-math', status: 'published' }]);
  assert.deepEqual(await rows(`SELECT id,"legacyHomeworkId",status FROM "Assignment"`),
    [{ id: 'legacy-assignment-legacy-homework', legacyHomeworkId: 'legacy-homework', status: 'published' }]);
  assert.deepEqual(await rows(`SELECT id,"enrollmentId",status FROM "AssignmentRecipient"`),
    [{ id: 'legacy-recipient-legacy-homework', enrollmentId: 'legacy-enrollment-legacy-s1', status: 'reviewed' }]);
  assert.deepEqual(await rows(`SELECT id,"legacySubmissionId",attempt FROM "AssignmentSubmission"`),
    [{ id: 'legacy-submission-legacy-submission', legacySubmissionId: 'legacy-submission', attempt: 1 }]);
  assert.deepEqual(await rows(`SELECT "submissionId","fileId" FROM "AssignmentSubmissionFile"`),
    [{ submissionId: 'legacy-submission-legacy-submission', fileId: 'legacy-file' }]);
  assert.deepEqual(await rows(`SELECT "submissionId",decision,status FROM "AssignmentReview"`),
    [{ submissionId: 'legacy-submission-legacy-submission', decision: 'accepted', status: 'published' }]);
  assert.deepEqual(await rows(`SELECT id,"legacyAttachmentId" FROM "LearningMaterial"`),
    [{ id: 'legacy-material-legacy-attachment', legacyAttachmentId: 'legacy-attachment' }]);
  assert.deepEqual(await rows(`SELECT "publicationId","enrollmentId" FROM "MaterialPublicationRecipient"`),
    [{ publicationId: 'legacy-material-publication-legacy-attachment-legacy-course-legacy-s1', enrollmentId: 'legacy-enrollment-legacy-s1' }]);
  const activeMaterialPublications = async () => (await rows(`SELECT COUNT(*)::int AS count FROM "MaterialPublication"
    WHERE "materialId"='legacy-material-legacy-attachment' AND "revokedAt" IS NULL`))[0].count;
  assert.equal(await activeMaterialPublications(), 1);
  await db.$executeRawUnsafe(`UPDATE "Homework" SET "taskNumbers"=ARRAY[]::INTEGER[] WHERE id='legacy-homework'`);
  assert.equal(await activeMaterialPublications(), 0);
  await db.$executeRawUnsafe(`UPDATE "Lesson" SET "focusTaskNumbers"=ARRAY[1] WHERE id='legacy-lesson'`);
  assert.equal(await activeMaterialPublications(), 1);
  await db.$executeRawUnsafe(`UPDATE "Lesson" SET "focusTaskNumbers"=ARRAY[]::INTEGER[] WHERE id='legacy-lesson'`);
  assert.equal(await activeMaterialPublications(), 0);
  await db.$executeRawUnsafe(`UPDATE "Homework" SET "taskNumbers"=ARRAY[1] WHERE id='legacy-homework'`);
  assert.equal(await activeMaterialPublications(), 1);
  await db.$executeRawUnsafe(`INSERT INTO "MaterialTopic" (id,"teacherId","taskNumber",title,"updatedAt")
    VALUES ('legacy-topic-2','legacy-t1',2,'Task 2',NOW())`);
  await db.$executeRawUnsafe(`UPDATE "MaterialAttachment" SET "topicId"='legacy-topic-2' WHERE id='legacy-attachment'`);
  assert.equal(await activeMaterialPublications(), 0);
  await db.$executeRawUnsafe(`UPDATE "MaterialAttachment" SET "topicId"='legacy-topic' WHERE id='legacy-attachment'`);
  assert.equal(await activeMaterialPublications(), 1);
  await assert.rejects(db.$executeRawUnsafe(`UPDATE "AssignmentSubmission" SET text='changed' WHERE id='legacy-submission-legacy-submission'`));
  await assert.rejects(db.$executeRawUnsafe(`UPDATE "AssignmentReview" SET comment='changed' WHERE "submissionId"='legacy-submission-legacy-submission'`));

  const firstBackfill = JSON.parse(backfill().trim().split('\n').at(-1));
  assert.equal(firstBackfill.memberships, 0);
  assert.equal(firstBackfill.grants, 0);
  await assert.rejects(db.$executeRawUnsafe(`DELETE FROM "WorkspaceMembership" WHERE id='legacy-student-legacy-s1'`));
  await assert.rejects(db.$executeRawUnsafe(`DELETE FROM "Enrollment" WHERE id='legacy-enrollment-legacy-s1'`));
  await assert.rejects(db.$executeRawUnsafe(`DELETE FROM "CourseTeacher" WHERE id='legacy-course-teacher-legacy-s1'`));
  await db.$executeRawUnsafe(`DELETE FROM "LegacyCourseMapping" WHERE "studentProfileId"='legacy-s2'`);
  await db.$executeRawUnsafe(`DELETE FROM "Enrollment" WHERE id='legacy-enrollment-legacy-s2'`);
  await db.$executeRawUnsafe(`DELETE FROM "CourseTeacher" WHERE id='legacy-course-teacher-legacy-s2'`);
  await db.$executeRawUnsafe(`DELETE FROM "Course" WHERE id='legacy-course-legacy-s2'`);
  await db.$executeRawUnsafe(`DELETE FROM "WorkspaceRoleGrant" WHERE "membershipId"='legacy-student-legacy-s2'`);
  await db.$executeRawUnsafe(`DELETE FROM "WorkspaceMembership" WHERE id='legacy-student-legacy-s2'`);
  const recovered = JSON.parse(backfill().trim().split('\n').at(-1));
  assert.equal(recovered.memberships, 1);
  assert.equal(recovered.grants, 1);
  assert.equal(await count('WorkspaceMembership'), 4);
  assert.equal(await count('LegacyCourseMapping'), 2);

  await db.$executeRawUnsafe(`INSERT INTO "User" (id,email,"passwordHash",role,"displayName","updatedAt") VALUES ('orphan-user','orphan@test.local','hash','teacher','Orphan',NOW())`);
  const membershipCount = await count('WorkspaceMembership');
  assert.match(backfill(false), /Legacy backfill preflight failed/);
  assert.equal(await count('WorkspaceMembership'), membershipCount);
  await db.$executeRawUnsafe(`DELETE FROM "User" WHERE id='orphan-user'`);

  await db.$executeRawUnsafe(`INSERT INTO "StudentProfile" (id,"userId","teacherId",name,access,"updatedAt") VALUES ('ambiguous-profile','legacy-tu1','legacy-t1','Ambiguous','active',NOW())`);
  assert.match(backfill(false), /"ambiguous":\["legacy-tu1"\]/);
  assert.equal(await count('WorkspaceMembership'), membershipCount);
  await db.$executeRawUnsafe(`DELETE FROM "StudentProfile" WHERE id='ambiguous-profile'`);

  await assert.rejects(db.$executeRawUnsafe(`INSERT INTO "WorkspaceMembership" (id,"workspaceId","userId","updatedAt") VALUES ('duplicate-member','legacy-legacy-t1','legacy-tu1',NOW())`));
  await assert.rejects(db.$executeRawUnsafe(`INSERT INTO "WorkspaceRoleGrant" (id,"membershipId",role) VALUES ('duplicate-grant','legacy-teacher-legacy-t1','admin')`));
  await db.$executeRawUnsafe(`INSERT INTO "WorkspaceInvitation" (id,"workspaceId",email,"tokenHash","expiresAt","inviterUserId") VALUES ('invite-one','legacy-legacy-t1','new@test.local','hash-one',NOW()+INTERVAL '1 day','legacy-tu1')`);
  await assert.rejects(db.$executeRawUnsafe(`INSERT INTO "WorkspaceInvitation" (id,"workspaceId",email,"tokenHash","expiresAt","inviterUserId") VALUES ('invite-two','legacy-legacy-t1','new@test.local','hash-two',NOW()+INTERVAL '1 day','legacy-tu1')`));
  await assert.rejects(db.$executeRawUnsafe(`INSERT INTO "WorkspaceRoleGrant" (id,"membershipId",role) VALUES ('bad-fk','missing-membership','student')`));
  await db.$executeRawUnsafe(`INSERT INTO "Workspace" (id,name,slug,"updatedAt") VALUES ('audit-workspace','Audit scope','audit-scope',NOW())`);
  await db.$executeRawUnsafe(`INSERT INTO "WorkspaceAuditEvent" (id,"workspaceId","targetType","targetId",action,"requestId") VALUES ('audit-event','audit-workspace','workspace','audit-workspace','test.created','migration-acceptance')`);
  await assert.rejects(db.$executeRawUnsafe(`DELETE FROM "Workspace" WHERE id='audit-workspace'`));

  await db.$disconnect();
  db = undefined;
  await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  db = new PrismaClient({ datasources: { db: { url: isolatedUrl } } });
  assert.match(deploy(), /successfully applied/i);
  const bootstrapEnv = {
    WORKSPACE_ADMIN_EMAIL: 'initial-admin@test.local',
    WORKSPACE_ADMIN_PASSWORD: `Bootstrap-${randomBytes(24).toString('hex')}!`,
    WORKSPACE_ADMIN_NAME: 'Initial Admin',
    WORKSPACE_NAME: 'Initial Workspace',
    WORKSPACE_TIMEZONE: 'UTC',
  };
  const bootstrapArgs = [tsNodeCli, '--project', 'tsconfig.json', 'src/cli/workspace-operator.ts', 'bootstrap'];
  assert.match(run(bootstrapArgs, true, bootstrapEnv), /Workspace created:/);
  assert.equal(await count('User'), 1);
  assert.equal(await count('Workspace'), 1);
  assert.equal(await count('WorkspaceMembership'), 1);
  assert.equal(await count('WorkspaceRoleGrant'), 1);
  assert.match(run(bootstrapArgs, false, bootstrapEnv), /initial bootstrap is disabled/);
  assert.equal(await count('User'), 1);
  assert.equal(await count('Workspace'), 1);

  console.log('Migration acceptance passed: fresh bootstrap, legacy data, replay, backfill recovery, constraints, catalog import, immutable progress and notification recipients.');
} finally {
  await db?.$disconnect();
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch(error => {
    console.error(`Could not remove isolated test database ${name}:`, error);
    process.exitCode = 1;
  });
  await admin.$disconnect();
  rmSync(temporary, { recursive: true, force: true });
}
