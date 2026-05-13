import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import { unauthorized } from '../common/app-error';
import { ROLE } from '../common/contracts';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET') || 'dev-secret-change-me',
    });
  }

  async validate(payload: { sub: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { teacherProfile: true, studentProfile: true },
    });
    if (!user) throw unauthorized();

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      teacherId: user.role === ROLE.TEACHER ? user.teacherProfile?.id : user.studentProfile?.teacherId,
      studentId: user.role === ROLE.STUDENT ? user.studentProfile?.id : undefined,
    };
  }
}
