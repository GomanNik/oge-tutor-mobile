import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, minutes } from '@nestjs/throttler';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PrismaModule } from './prisma/prisma.module';
import { JwtStrategy } from './auth/jwt.strategy';
import { AuthModule } from './auth/auth.module';
import { BootstrapModule } from './bootstrap/bootstrap.module';
import { TeacherModule } from './teacher/teacher.module';
import { StudentsModule } from './students/students.module';
import { LessonsModule } from './lessons/lessons.module';
import { HomeworksModule } from './homeworks/homeworks.module';
import { FilesModule } from './files/files.module';
import { MaterialsModule } from './materials/materials.module';
import { ProgressModule } from './progress/progress.module';
import { HealthModule } from './health/health.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RoleGuard } from './common/role.guard';
import { LegacyAccessGuard } from './workspace/legacy.guard';
import { WorkspaceModule } from './workspace/workspace.module';
import { ProgramCatalogModule } from './program-catalog/program-catalog.module';
import { RequestLoggerMiddleware } from './common/request-logger.middleware';
import { OperationLoggerInterceptor } from './common/operation-logger.interceptor';
import { validateEnv } from './config/env.validation';
import { authTargetTracker, AUTH_THROTTLE_TTL_MS } from './auth/auth-throttle';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ThrottlerModule.forRoot({
      throttlers: [
        { name: 'ip', ttl: minutes(1), limit: 30 },
        { name: 'target', ttl: AUTH_THROTTLE_TTL_MS, limit: 8, getTracker: authTargetTracker },
      ],
      errorMessage: 'Слишком много попыток. Повторите позже.',
    }),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}),
    PrismaModule,
    AuthModule,
    BootstrapModule,
    TeacherModule,
    StudentsModule,
    LessonsModule,
    HomeworksModule,
    FilesModule,
    MaterialsModule,
    ProgressModule,
    HealthModule,
    WorkspaceModule,
    ProgramCatalogModule,
  ],
  providers: [
    JwtStrategy,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: LegacyAccessGuard },
    { provide: APP_GUARD, useClass: RoleGuard },
    { provide: APP_INTERCEPTOR, useClass: OperationLoggerInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }
}
