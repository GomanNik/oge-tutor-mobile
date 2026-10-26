import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const databaseUrl = process.env.DATABASE_URL;
const container = process.env.RELEASE_POSTGRES_CONTAINER;
if (!databaseUrl || !/(test|e2e|ci)/i.test(new URL(databaseUrl).pathname) || !container) throw new Error('A disposable test DATABASE_URL and explicit RELEASE_POSTGRES_CONTAINER are required.');
const suffix = randomBytes(6).toString('hex');
const sourceName = `oge_restore_ci_${suffix}_source`, restoredName = `oge_restore_ci_${suffix}_restored`;
const withDb = name => { const url = new URL(databaseUrl); url.pathname = `/${name}`; return url.toString(); };
const pgUser = decodeURIComponent(new URL(databaseUrl).username);
const temp = await mkdtemp(path.join(os.tmpdir(), 'oge-release-drill-'));
const sourceFiles = path.join(temp, 'source-files'), restoredFiles = path.join(temp, 'restored-files');
const dumpPath = path.join(temp, 'database.dump');
const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
let source, restored, server;
let serverLogs = '';

async function hashFile(location) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(location)) hash.update(chunk);
  return hash.digest('hex');
}
async function verifyBundle(manifest) {
  assert.equal(await hashFile(dumpPath), manifest.databaseSha256, 'Database dump checksum mismatch');
  for (const file of manifest.files) assert.equal(await hashFile(path.join(restoredFiles, file.name)), file.checksum, `File checksum mismatch: ${file.id}`);
}
async function postgresStream(command, args, input, output) {
  const child = spawn('docker', ['exec', ...(input ? ['-i'] : []), container, command, '-U', pgUser, ...args], { windowsHide: true, stdio: [input ? 'pipe' : 'ignore', output ? 'pipe' : 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-5000); });
  const completed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`${command} failed (${code}): ${stderr}`)));
  });
  await Promise.all([completed, ...(input ? [pipeline(createReadStream(input), child.stdin)] : []), ...(output ? [pipeline(child.stdout, createWriteStream(output))] : [])]);
}
async function freePort() {
  const listener = createServer();
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  return port;
}
async function seed() {
  const passwordHash = await bcrypt.hash('RestoreDrill-test-password', 4);
  const teacher = await source.user.create({ data: { id: 'restore-teacher', email: 'restore-teacher@test.local', displayName: 'Restore Teacher', passwordHash } });
  const student = await source.user.create({ data: { id: 'restore-student', email: 'restore-student@test.local', displayName: 'Restore Student', passwordHash } });
  await source.workspace.create({ data: { id: 'restore-workspace', name: 'Restore drill', slug: 'restore-drill' } });
  for (const [user, roles] of [[teacher, ['admin', 'teacher']], [student, ['student']]]) await source.workspaceMembership.create({ data: { id: `member-${user.id}`, workspaceId: 'restore-workspace', userId: user.id, roles: { create: roles.map(role => ({ role })) } } });
  await source.subject.create({ data: { id: 'restore-subject', scopeKey: 'global', code: 'restore-science', name: 'Restore Science' } });
  await source.examProgram.create({ data: { id: 'restore-program', scopeKey: 'global', subjectId: 'restore-subject', code: 'restore-exam', examType: 'ege', variant: 'general', name: 'Restore Exam' } });
  await source.programVersion.create({ data: { id: 'restore-version', programId: 'restore-program', period: 'restore-fixture', revisionNumber: 1 } });
  const task = await source.taskDefinition.create({ data: { id: 'restore-task', programVersionId: 'restore-version', code: 'R1', title: 'Restore task', position: 1, kind: 'short_answer', maxScore: 1 } });
  await source.programVersion.update({ where: { id: 'restore-version' }, data: { status: 'published', publishedAt: new Date() } });
  await source.course.create({ data: { id: 'restore-course', workspaceId: 'restore-workspace', programVersionId: 'restore-version', title: 'Restore course', defaultFormat: 'individual', capacity: 1, startsOn: new Date(), timezone: 'UTC', status: 'active' } });
  await source.courseTeacher.create({ data: { id: 'restore-course-teacher', workspaceId: 'restore-workspace', courseId: 'restore-course', membershipId: `member-${teacher.id}`, role: 'lead', startsOn: new Date() } });
  await source.enrollment.create({ data: { id: 'restore-enrollment', workspaceId: 'restore-workspace', courseId: 'restore-course', membershipId: `member-${student.id}`, status: 'active', startsOn: new Date() } });
  const manifestFiles = [];
  for (const [id, content, ownerId, scope] of [['restore-material-file', 'Persistent material bytes', teacher.id, 'teacher_material'], ['restore-answer-file', 'Persistent private answer bytes', student.id, 'private_submission']]) {
    const bytes = Buffer.from(content), name = `${id}.txt`, storagePath = path.join(sourceFiles, name);
    await writeFile(storagePath, bytes);
    const checksum = await hashFile(storagePath);
    await source.fileResource.create({ data: { id, ownerId, workspaceId: 'restore-workspace', scope, originalName: name, mimeType: 'text/plain', size: bytes.length, url: '', storagePath, checksum } });
    manifestFiles.push({ id, name, checksum, size: bytes.length });
  }
  await source.learningMaterial.create({ data: { id: 'restore-material', workspaceId: 'restore-workspace', programVersionId: 'restore-version', taskDefinitionIds: [task.id], title: 'Restored material', description: '', fileId: 'restore-material-file', createdByUserId: teacher.id } });
  await source.materialPublication.create({ data: { id: 'restore-publication', materialId: 'restore-material', courseId: 'restore-course' } });
  await source.materialPublicationRecipient.create({ data: { publicationId: 'restore-publication', courseId: 'restore-course', enrollmentId: 'restore-enrollment' } });
  const dueAt = new Date(Date.now() + 10 * 86400000);
  await source.assignment.create({ data: { id: 'restore-assignment', courseId: 'restore-course', createdByUserId: teacher.id, title: 'Restored assignment', instructions: 'Persistent instructions', taskDefinitionIds: [task.id], taskSnapshot: [{ id: task.id, code: task.code, title: task.title, maxScore: 1, criteria: [] }], dueAt, status: 'published', publishedAt: new Date() } });
  await source.assignmentRecipient.create({ data: { id: 'restore-recipient', assignmentId: 'restore-assignment', courseId: 'restore-course', enrollmentId: 'restore-enrollment', dueAt, status: 'submitted' } });
  await source.assignmentSubmission.create({ data: { id: 'restore-submission', recipientId: 'restore-recipient', attempt: 1, text: 'Persistent answer', contentSnapshot: { title: 'Restored assignment' } } });
  await source.assignmentSubmissionFile.create({ data: { submissionId: 'restore-submission', fileId: 'restore-answer-file' } });
  return manifestFiles;
}
async function api(base, route, options = {}) {
  const response = await fetch(`${base}${route}`, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers }, ...(options.body ? { body: JSON.stringify(options.body) } : {}), signal: AbortSignal.timeout(10000) });
  const data = await response.json();
  assert(response.ok, `${options.method || 'GET'} ${route}: ${response.status} ${data.code || ''}`);
  return data;
}

try {
  await mkdir(sourceFiles); await mkdir(restoredFiles);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${sourceName}"`);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${restoredName}"`);
  const prismaCli = path.join(path.dirname(require.resolve('prisma/package.json')), 'build', 'index.js');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], { cwd: backend, env: { ...process.env, DATABASE_URL: withDb(sourceName) }, windowsHide: true, stdio: 'pipe' });
  source = new PrismaClient({ datasources: { db: { url: withDb(sourceName) } } });
  const files = await seed();
  await postgresStream('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--dbname', sourceName], null, dumpPath);
  await cp(sourceFiles, restoredFiles, { recursive: true });
  const manifest = { databaseSha256: await hashFile(dumpPath), files };
  await verifyBundle(manifest);
  await writeFile(path.join(restoredFiles, files[0].name), 'Corrupted backup bytes');
  await assert.rejects(() => verifyBundle(manifest), /checksum mismatch/);
  await cp(path.join(sourceFiles, files[0].name), path.join(restoredFiles, files[0].name));
  await verifyBundle(manifest);
  await postgresStream('pg_restore', ['--exit-on-error', '--no-owner', '--no-acl', '--dbname', restoredName], dumpPath);
  restored = new PrismaClient({ datasources: { db: { url: withDb(restoredName) } } });
  for (const file of files) {
    assert.equal((await restored.fileResource.findUniqueOrThrow({ where: { id: file.id } })).checksum, file.checksum);
    await restored.fileResource.update({ where: { id: file.id }, data: { storagePath: path.join(restoredFiles, file.name) } });
  }
  assert.equal(await restored.assignmentSubmission.count(), await source.assignmentSubmission.count());
  assert.equal(await restored.fileResource.count(), files.length);
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['dist/src/main.js'], { cwd: backend, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: {
    ...process.env, DATABASE_URL: withDb(restoredName), NODE_ENV: 'test', PORT: String(port), UPLOAD_DIR: restoredFiles,
    JWT_SECRET: 'restore-drill-jwt-secret', MAILER_PROVIDER: 'noop', LEGACY_API_MODE: 'disabled', LEGACY_CUTOVER_CONFIRM: 'verified-backup-and-reconciliation',
    PUBLIC_BACKEND_URL: base, APP_FRONTEND_URL: base, FRONTEND_ORIGIN: base, CLI_MODE: 'true',
  } });
  for (const stream of [server.stdout, server.stderr]) stream.on('data', chunk => { serverLogs = (serverLogs + chunk).slice(-12000); });
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode !== null) throw new Error(`Restored API exited: ${serverLogs}`);
    try { if ((await fetch(`${base}/health/ready`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch { /* The restored process is still starting. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert(ready, `Restored API did not start: ${serverLogs}`);
  const login = email => api(base, '/api/v2/auth/login', { method: 'POST', body: { email, password: 'RestoreDrill-test-password' } });
  const teacher = await login('restore-teacher@test.local'), student = await login('restore-student@test.local');
  const headers = (account, role) => ({ Authorization: `Bearer ${account.session.token}`, 'X-Active-Role': role });
  const studentHeaders = headers(student, 'student'), teacherHeaders = headers(teacher, 'teacher');
  const prefix = '/api/v2/workspaces/restore-workspace';
  const materials = await api(base, `${prefix}/materials`, { headers: studentHeaders });
  assert(materials.items.some(item => item.id === 'restore-material'));
  for (const file of files) {
    const response = await fetch(`${base}${prefix}/files/${file.id}/download`, { headers: studentHeaders, signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200);
    assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'), file.checksum);
  }
  const attempts = await api(base, `${prefix}/assignment-recipients/restore-recipient/submissions`, { headers: studentHeaders });
  assert.equal(attempts.items[0].text, 'Persistent answer');
  const assignment = await api(base, `${prefix}/assignments`, { method: 'POST', headers: { ...teacherHeaders, 'Idempotency-Key': 'restore-fresh-assignment' }, body: { courseId: 'restore-course', title: 'Work after restore', instructions: 'Verify restored writes', taskDefinitionIds: ['restore-task'], dueAt: new Date(Date.now() + 86400000).toISOString(), fileIds: [] } });
  await api(base, `${prefix}/assignments/${assignment.item.id}/publish`, { method: 'POST', headers: { ...teacherHeaders, 'If-Match': String(assignment.item.revision), 'Idempotency-Key': 'restore-publish' }, body: { recipientEnrollmentIds: ['restore-enrollment'] } });
  const recipients = await api(base, `${prefix}/assignments/${assignment.item.id}/recipients`, { headers: studentHeaders });
  const submitted = await api(base, `${prefix}/assignment-recipients/${recipients.items[0].id}/submissions`, { method: 'POST', headers: { ...studentHeaders, 'If-Match': String(recipients.items[0].revision), 'Idempotency-Key': 'restore-submit' }, body: { text: 'New answer after restore', fileIds: [] } });
  const newAttempts = await api(base, `${prefix}/assignment-recipients/${recipients.items[0].id}/submissions`, { headers: teacherHeaders });
  const review = await api(base, `${prefix}/submissions/${newAttempts.items[0].id}/reviews`, { method: 'POST', headers: { ...teacherHeaders, 'If-Match': String(submitted.item.revision), 'Idempotency-Key': 'restore-review' }, body: { decision: 'accepted', comment: 'Verified after restore', scores: [{ taskDefinitionId: 'restore-task', score: 1 }], fileIds: [] } });
  await api(base, `${prefix}/reviews/${review.item.id}/publish`, { method: 'POST', headers: { ...teacherHeaders, 'If-Match': String(review.item.revision), 'Idempotency-Key': 'restore-review-publish' }, body: {} });
  const progress = await api(base, `${prefix}/enrollments/restore-enrollment/progress`, { headers: studentHeaders });
  assert.equal(progress.item.tasks[0].event.score, 1);
  assert.equal((await fetch(`${base}/bootstrap`, { headers: studentHeaders })).status, 410);
  const report = { ok: true, databaseRestored: true, filesVerified: files.length, corruptBundleRejected: true, restoredApiLogin: true,
    materialsAndPrivateAnswers: true, freshSubmissionAndReview: true, progressAfterRestore: true, legacyDisabled: true, fixtureOnly: true };
  if (process.env.RELEASE_DRILL_REPORT) { await mkdir(path.dirname(process.env.RELEASE_DRILL_REPORT), { recursive: true }); await writeFile(process.env.RELEASE_DRILL_REPORT, `${JSON.stringify(report, null, 2)}\n`); }
  process.stdout.write(`${JSON.stringify(report)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
  process.exitCode = 1;
} finally {
  if (server && server.exitCode === null) {
    const exited = new Promise(resolve => server.once('close', resolve));
    server.kill(); await exited;
  }
  await source?.$disconnect(); await restored?.$disconnect();
  for (const name of [sourceName, restoredName]) {
    if (!/^oge_restore_ci_[a-f0-9]{12}_(source|restored)$/.test(name)) throw new Error('Unsafe restore database cleanup target');
    await admin.$executeRaw`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=${name} AND pid<>pg_backend_pid()`;
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}"`);
  }
  await admin.$disconnect();
  if (path.dirname(temp) !== os.tmpdir() || !path.basename(temp).startsWith('oge-release-drill-')) throw new Error('Unsafe restore fixture cleanup target');
  await rm(temp, { recursive: true, force: true });
}
