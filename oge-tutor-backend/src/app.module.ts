import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
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
import { RequestLoggerMiddleware } from './common/request-logger.middleware';
import { OperationLoggerInterceptor } from './common/operation-logger.interceptor';
import { validateEnv } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
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
  ],
  providers: [
    JwtStrategy,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RoleGuard },
    { provide: APP_INTERCEPTOR, useClass: OperationLoggerInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }
}
