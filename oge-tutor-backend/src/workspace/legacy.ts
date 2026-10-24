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
  const courseId = `legacy-course-${student.id}`;
  const enrollmentId = `legacy-enrollment-${student.id}`;
  const teacher = await db.teacherProfile.findUniqueOrThrow({ where: { id: student.teacherId } });
  const lead = await db.workspaceMembership.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId, userId: teacher.userId } } });
  const workspace = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  await db.course.upsert({
    where: { id: courseId },
    create: {
      id: courseId, workspaceId, programVersionId: 'legacy-version-oge-math',
      title: `ОГЭ математика · ${student.name}`, defaultFormat: 'individual', capacity: 1,
      startsOn: student.createdAt, timezone: workspace.timezone,
      status: student.access === 'active' ? 'active' : 'draft',
    },
    update: {},
  });
  await db.courseTeacher.upsert({
    where: { id: `legacy-course-teacher-${student.id}` },
    create: {
      id: `legacy-course-teacher-${student.id}`, workspaceId, courseId,
      membershipId: lead.id, role: 'lead', startsOn: student.createdAt,
    },
    update: {},
  });
  await db.enrollment.upsert({
    where: { id: enrollmentId },
    create: {
      id: enrollmentId, workspaceId, courseId, membershipId: member.id,
      status: student.access === 'active' ? 'active' : 'invited',
      startsOn: student.access === 'active' ? student.createdAt : null,
      goal: student.goal, note: student.note,
    },
    update: {},
  });
  await db.legacyCourseMapping.upsert({
    where: { studentProfileId: student.id },
    create: { studentProfileId: student.id, courseId, enrollmentId },
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
  const mappingCourse = await db.legacyCourseMapping.findUnique({ where: { studentProfileId: studentId } });
  if (mappingCourse) {
    const enrollment = await db.enrollment.findUniqueOrThrow({ where: { id: mappingCourse.enrollmentId } });
    await db.enrollment.update({
      where: { id: mappingCourse.enrollmentId },
      data: { status: access === 'active' ? 'active' : access === 'disabled' ? 'paused' : 'invited',
        ...(access === 'active' && !enrollment.startsOn ? { startsOn: new Date() } : {}), revision: { increment: 1 } },
    });
    await db.course.update({
      where: { id: mappingCourse.courseId },
      data: { status: access === 'active' ? 'active' : 'draft', revision: { increment: 1 } },
    });
  }
}
