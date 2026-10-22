import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { AuthUser } from '../common/current-user';
import { unauthorized } from '../common/app-error';

@Injectable()
export class LegacyAccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const publicRoute = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (publicRoute) return true;
    const request = context.switchToHttp().getRequest();
    if (request.path.startsWith('/api/v2/')) return true;
    const user = request.user as AuthUser | undefined;
    if (!user?.role) throw unauthorized();
    const teacherId = user.role === 'teacher' ? user.teacherId : undefined;
    const studentId = user.role === 'student' ? user.studentId : undefined;
    if (!teacherId && !studentId) throw unauthorized();
    if (studentId) {
      const student = await this.prisma.studentProfile.findUnique({ where: { id: studentId } });
      if (!student || student.access !== 'active') throw unauthorized();
    }
    const legacyTeacherId = teacherId || (await this.prisma.studentProfile.findUnique({ where: { id: studentId! } }))?.teacherId;
    if (!legacyTeacherId) throw unauthorized();
    const mapping = await this.prisma.legacyWorkspaceMapping.findUnique({
      where: { teacherProfileId: legacyTeacherId },
      include: { workspace: true },
    });
    if (!mapping || mapping.workspace.status !== 'active') throw unauthorized();
    const member = await this.prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId: mapping.workspaceId, userId: user.id } },
      include: { roles: true },
    });
    if (member?.status !== 'active' || !member.roles.some(role => role.role === user.role && !role.revokedAt)) throw unauthorized();
    return true;
  }
}
