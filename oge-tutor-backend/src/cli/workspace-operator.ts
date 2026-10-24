import bcrypt from 'bcryptjs';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ensureLegacyStudent, ensureLegacyTeacher } from '../workspace/legacy';
import { validateEmail, validatePassword } from '../common/validation';

const prisma = new PrismaClient();

function name(value: string | undefined, field: string) {
  const trimmed = String(value || '').trim();
  if (trimmed.length < 2 || trimmed.length > 120) throw new Error(`${field} must have 2-120 characters.`);
  return trimmed;
}

function timezone(value: string | undefined) {
  const zone = String(value || 'UTC').trim();
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); }
  catch { throw new Error('WORKSPACE_TIMEZONE must be an IANA timezone.'); }
  return zone;
}

async function bootstrap() {
  const email = validateEmail(process.env.WORKSPACE_ADMIN_EMAIL);
  const password = validatePassword(process.env.WORKSPACE_ADMIN_PASSWORD);
  const displayName = name(process.env.WORKSPACE_ADMIN_NAME, 'WORKSPACE_ADMIN_NAME');
  const workspaceName = name(process.env.WORKSPACE_NAME, 'WORKSPACE_NAME');
  const zone = timezone(process.env.WORKSPACE_TIMEZONE);
  const passwordHash = await bcrypt.hash(password, 12);
  const workspace = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(843728462)::text`;
    if (await tx.workspace.count() !== 0) throw new Error('A workspace already exists; initial bootstrap is disabled.');
    if (await tx.user.findUnique({ where: { email } })) throw new Error('Admin email already belongs to an account.');
    const user = await tx.user.create({ data: { email, displayName, passwordHash, role: null } });
    const row = await tx.workspace.create({ data: { name: workspaceName, slug: `operator-${randomUUID()}`, timezone: zone } });
    const member = await tx.workspaceMembership.create({ data: { workspaceId: row.id, userId: user.id } });
    await tx.workspaceRoleGrant.create({ data: { membershipId: member.id, role: 'admin', grantedById: user.id } });
    await tx.workspaceAuditEvent.create({ data: { workspaceId: row.id, actorKind: 'operator', targetType: 'workspace', targetId: row.id, action: 'workspace.bootstrapped', changes: {}, requestId: randomUUID() } });
    return row;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  console.log(`Workspace created: ${workspace.id}`);
}

async function create() {
  const adminUserId = String(process.env.WORKSPACE_OPERATOR_USER_ID || '').trim();
  if (!adminUserId) throw new Error('WORKSPACE_OPERATOR_USER_ID is required.');
  const workspaceName = name(process.env.WORKSPACE_NAME, 'WORKSPACE_NAME');
  const zone = timezone(process.env.WORKSPACE_TIMEZONE);
  const workspace = await prisma.$transaction(async tx => {
    const user = await tx.user.findUnique({ where: { id: adminUserId } });
    if (!user) throw new Error('Admin user not found.');
    const row = await tx.workspace.create({ data: { name: workspaceName, slug: `operator-${randomUUID()}`, timezone: zone } });
    const member = await tx.workspaceMembership.create({ data: { workspaceId: row.id, userId: adminUserId } });
    await tx.workspaceRoleGrant.create({ data: { membershipId: member.id, role: 'admin', grantedById: adminUserId } });
    await tx.workspaceAuditEvent.create({ data: { workspaceId: row.id, actorKind: 'operator', targetType: 'workspace', targetId: row.id, action: 'workspace.created', changes: {}, requestId: randomUUID() } });
    return row;
  });
  console.log(`Workspace created: ${workspace.id}`);
}

async function backfill() {
  const teachers = await prisma.teacherProfile.findMany({ select: { id: true, userId: true, name: true } });
  const students = await prisma.studentProfile.findMany({ select: { id: true, userId: true, teacherId: true, name: true } });
  const accounts = await prisma.user.findMany({ where: { role: { not: null } }, select: {
    id: true, role: true, teacherProfile: { select: { id: true } }, studentProfile: { select: { id: true } },
  } });
  const mappings = await prisma.legacyWorkspaceMapping.findMany();
  const teacherIds = new Set(teachers.map(row => row.id));
  const ambiguous = accounts.filter(row => row.teacherProfile && row.studentProfile).map(row => row.id);
  const orphaned = [
    ...teachers.filter(row => !row.name.trim()).map(row => row.id),
    ...students.filter(row => !row.name.trim() || !teacherIds.has(row.teacherId)).map(row => row.id),
    ...accounts.filter(row => row.role === 'teacher' ? !row.teacherProfile : !row.studentProfile).map(row => row.id),
    ...mappings.filter(row => row.workspaceId !== `legacy-${row.teacherProfileId}`).map(row => row.teacherProfileId),
  ];
  if (ambiguous.length || orphaned.length) {
    console.error(JSON.stringify({ ambiguous, orphaned }));
    throw new Error('Legacy backfill preflight failed; no rows were changed.');
  }
  const before = {
    workspaces: await prisma.legacyWorkspaceMapping.count(),
    memberships: await prisma.workspaceMembership.count(),
    grants: await prisma.workspaceRoleGrant.count(),
  };
  for (const teacher of teachers) await prisma.$transaction(tx => ensureLegacyTeacher(tx, teacher.id));
  for (const student of students) await prisma.$transaction(tx => ensureLegacyStudent(tx, student.id));
  const after = {
    workspaces: await prisma.legacyWorkspaceMapping.count(),
    memberships: await prisma.workspaceMembership.count(),
    grants: await prisma.workspaceRoleGrant.count(),
  };
  console.log(JSON.stringify({
    teachers: teachers.length, users: accounts.length, students: students.length,
    workspaces: after.workspaces - before.workspaces,
    memberships: after.memberships - before.memberships,
    grants: after.grants - before.grants,
    ambiguous, orphaned,
  }));
}

const command = process.argv[2];
const action = command === 'bootstrap' ? bootstrap : command === 'create' ? create : command === 'backfill' ? backfill : null;
if (!action) {
  console.error('Usage: workspace:operator -- bootstrap|create|backfill');
  process.exitCode = 2;
} else {
  action().catch(error => {
    console.error(error instanceof Error ? error.message : 'Workspace command failed.');
    process.exitCode = 1;
  }).finally(() => prisma.$disconnect());
}
