import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Role } from './contracts';

export type AuthUser = {
  id: string;
  email: string;
  role: Role;
  teacherId?: string;
  studentId?: string;
};

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
