import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { CoursesController, EnrollmentBatchesController } from './courses.controller';
import { CoursesService } from './courses.service';

@Module({ imports: [PrismaModule, WorkspaceModule], controllers: [CoursesController, EnrollmentBatchesController], providers: [CoursesService] })
export class CoursesModule {}
