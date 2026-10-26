import { Injectable } from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/current-user';
import { AppError, forbidden, notFound } from '../common/app-error';
import { legacyApiMode } from './legacy-mode';

export type WorkspaceContext = { userId: string; sessionId: string; workspaceId: string; role: WorkspaceRole; requestId: string };

@Injectable()
export class WorkspaceContextService {
  constructor(private readonly prisma: PrismaService) {}

  async listMyContexts(userId: string) {
    const rows = await this.prisma.workspaceMembership.findMany({
      where: { userId, status: 'active', workspace: { status: 'active' } },
      include: { workspace: { include: { legacyMapping: true } }, roles: true, user: { include: { teacherProfile: true, studentProfile: true } } },
      orderBy: [{ workspace: { name: 'asc' } }, { id: 'asc' }],
    });
    return rows.map(row => ({
      workspaceId: row.workspaceId,
      name: row.workspace.name,
      status: row.workspace.status,
      legacyRole: legacyApiMode() !== 'enabled' ? null : row.user.role === 'teacher' && row.user.teacherProfile && row.workspace.legacyMapping?.teacherProfileId === row.user.teacherProfile.id
        ? 'teacher'
        : row.user.role === 'student' && row.user.studentProfile?.access === 'active' && row.workspace.legacyMapping?.teacherProfileId === row.user.studentProfile.teacherId
          ? 'student'
          : null,
      roles: row.roles.filter(grant => !grant.revokedAt).map(grant => grant.role),
    })).filter(row => row.roles.length > 0);
  }

  async resolve(user: AuthUser, workspaceId: string, roleInput: string | undefined, requestId: string): Promise<WorkspaceContext> {
    if (!roleInput || !Object.values(WorkspaceRole).includes(roleInput as WorkspaceRole)) {
      throw new AppError(400, 'missing_context', 'Выберите роль в рабочем пространстве.');
    }
    const member = await this.prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: user.id } },
      include: { workspace: true, roles: true },
    });
    if (!member || member.workspace.status !== 'active') throw notFound();
    if (member.status !== 'active' || !member.roles.some(grant => grant.role === roleInput && !grant.revokedAt)) throw forbidden();
    return { userId: user.id, sessionId: user.sessionId || '', workspaceId, role: roleInput as WorkspaceRole, requestId };
  }

  requireAdmin(ctx: WorkspaceContext) {
    if (ctx.role !== 'admin') throw forbidden();
  }
}
