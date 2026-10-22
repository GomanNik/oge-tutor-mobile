import { AccessStatus, Prisma, PrismaClient } from '@prisma/client';

type Db = Prisma.TransactionClient | PrismaClient;

export async function ensureLegacyTeacher(db: Db, teacherId: string) {
  const teacher = await db.teacherProfile.findUniqueOrThrow({ where: { id: teacherId } });
  const workspaceId = `legacy-${teacherId}`;
  const mapping = await db.legacyWorkspaceMapping.findUnique({ where: { teacherProfileId: teacherId } });
  if (mapping && mapping.workspaceId !== workspaceId) throw new Error(`Conflicting legacy workspace mapping for teacher ${teacherId}`);
  await db.workspace.upsert({
    where: { id: workspaceId },
    create: { id: workspaceId, name: teacher.name, slug: workspaceId, timezone: 'UTC' },
    update: {},
  });
  await db.legacyWorkspaceMapping.upsert({
    where: { teacherProfileId: teacherId },
    create: { teacherProfileId: teacherId, workspaceId },
    update: {},
  });
  const member = await db.workspaceMembership.upsert({
    where: { workspaceId_userId: { workspaceId, userId: teacher.userId } },
    create: { workspaceId, userId: teacher.userId, displayNameOverride: teacher.name },
    update: {},
  });
  for (const role of ['admin', 'teacher'] as const) {
    await db.workspaceRoleGrant.upsert({
      where: { membershipId_role: { membershipId: member.id, role } },
      create: { membershipId: member.id, role },
      update: {},
    });
  }
  return workspaceId;
}

export async function ensureLegacyStudent(db: Db, studentId: string) {
  const student = await db.studentProfile.findUniqueOrThrow({ where: { id: studentId } });
  const workspaceId = await ensureLegacyTeacher(db, student.teacherId);
  const status = student.access === 'disabled' ? 'suspended' : 'active';
  const member = await db.workspaceMembership.upsert({
    where: { workspaceId_userId: { workspaceId, userId: student.userId } },
    create: { workspaceId, userId: student.userId, status, displayNameOverride: student.name },
    update: {},
  });
  await db.workspaceRoleGrant.upsert({
    where: { membershipId_role: { membershipId: member.id, role: 'student' } },
    create: { membershipId: member.id, role: 'student' },
    update: {},
  });
  return member;
}

export async function syncLegacyStudentAccess(db: Db, studentId: string, access: AccessStatus) {
  const student = await db.studentProfile.findUniqueOrThrow({ where: { id: studentId } });
  const mapping = await db.legacyWorkspaceMapping.findUniqueOrThrow({ where: { teacherProfileId: student.teacherId } });
  await db.workspaceMembership.update({
    where: { workspaceId_userId: { workspaceId: mapping.workspaceId, userId: student.userId } },
    data: {
      status: access === 'disabled' ? 'suspended' : 'active',
      suspendedAt: access === 'disabled' ? new Date() : null,
      revision: { increment: 1 },
    },
  });
}
