import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import { unauthorized } from '../common/app-error';
import { ACCESS_STATUS, ROLE } from '../common/contracts';
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

  async validate(payload: { sub: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { teacherProfile: true, studentProfile: true },
    });
    if (!user) throw unauthorized();
    if (user.role === ROLE.STUDENT && user.studentProfile?.access !== ACCESS_STATUS.ACTIVE) {
      throw unauthorized();
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      teacherId: user.role === ROLE.TEACHER ? user.teacherProfile?.id : user.studentProfile?.teacherId,
      studentId: user.role === ROLE.STUDENT ? user.studentProfile?.id : undefined,
    };
  }
}
