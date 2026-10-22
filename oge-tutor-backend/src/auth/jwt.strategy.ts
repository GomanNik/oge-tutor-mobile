import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import { unauthorized } from '../common/app-error';
import { ROLE } from '../common/contracts';
import { getJwtSecret } from './auth-config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(config),
    });
  }

  async validate(payload: { sub?: unknown; sid?: unknown }) {
    if (typeof payload?.sub !== 'string' || !payload.sub || typeof payload.sid !== 'string' || !payload.sid) throw unauthorized();
    const session = await this.prisma.authSession.findUnique({
      where: { id: payload.sid },
      include: { user: { include: { teacherProfile: true, studentProfile: true } } },
    });
    if (!session || session.userId !== payload.sub || session.revokedAt || session.expiresAt.getTime() <= Date.now()) throw unauthorized();
    const user = session.user;
    if (!user || session.version !== user.sessionVersion) throw unauthorized();
    return {
      id: user.id,
      sessionId: session.id,
      email: user.email,
      role: user.role,
      teacherId: user.role === ROLE.TEACHER ? user.teacherProfile?.id : user.studentProfile?.teacherId,
      studentId: user.role === ROLE.STUDENT ? user.studentProfile?.id : undefined,
    };
  }
}
