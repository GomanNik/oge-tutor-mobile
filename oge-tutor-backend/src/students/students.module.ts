/*
 * OGE Tutor Backend — students module.
 * Supports teacher-managed student accounts and student self-service profile/account updates.
 */
import { Module } from '@nestjs/common';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';

@Module({
  controllers: [StudentsController],
  providers: [StudentsService],
  exports: [StudentsService],
})
export class StudentsModule {}
