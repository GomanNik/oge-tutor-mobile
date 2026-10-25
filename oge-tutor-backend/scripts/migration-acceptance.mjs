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
  assert.equal(await count('LessonTeacher'), 1);
  assert.equal(await count('LessonParticipant'), 1);
  assert.deepEqual(await rows(`SELECT id,"courseId" FROM "Lesson" WHERE id='legacy-lesson'`),
    [{ id: 'legacy-lesson', courseId: 'legacy-course-legacy-s1' }]);
  assert.deepEqual(await rows(`SELECT c.id,c.status,e.status AS "enrollmentStatus" FROM "Course" c JOIN "Enrollment" e ON e."courseId"=c.id WHERE c.id='legacy-course-legacy-s1'`),
    [{ id: 'legacy-course-legacy-s1', status: 'active', enrollmentStatus: 'active' }]);
  assert.deepEqual(await rows(`SELECT id,status FROM "ProgramVersion" WHERE id='legacy-version-oge-math'`),
    [{ id: 'legacy-version-oge-math', status: 'published' }]);

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

  console.log('Migration acceptance passed: fresh bootstrap, legacy data, replay, backfill recovery, constraints, catalog import.');
} finally {
  await db?.$disconnect();
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch(error => {
    console.error(`Could not remove isolated test database ${name}:`, error);
    process.exitCode = 1;
  });
  await admin.$disconnect();
  rmSync(temporary, { recursive: true, force: true });
}
