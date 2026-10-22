import { ArrayUnique } from 'class-validator';
import { PROGRESS_COVERAGE_STATUS, PROGRESS_MASTERY_LEVEL, PROGRESS_SOURCE } from '../common/contracts';
import { DateField, EnumField, IntegerField, NestedArrayField, TaskNumberField, TextField } from '../common/dto-fields';

export class UpdateTaskProgressDto {
  @EnumField(PROGRESS_COVERAGE_STATUS) coverageStatus?: string;
  @EnumField([...Object.values(PROGRESS_MASTERY_LEVEL), ''], false, true) masteryLevel?: string | null;
  @TextField() teacherComment?: string;
  @TextField() recommendedAction?: string;
}
export class ResolveAssessmentDto extends UpdateTaskProgressDto {}
export class ProgressHistoryEntryDto {
  @TextField() id?: string;
  @TextField() type?: string;
  @EnumField(PROGRESS_SOURCE) source?: string;
  @TaskNumberField() taskNumber!: number;
  @TextField() lessonId?: string;
  @EnumField(PROGRESS_COVERAGE_STATUS, false, true) coverageStatus?: string | null;
  @EnumField(PROGRESS_MASTERY_LEVEL, false, true) masteryLevel?: string | null;
  @TextField() comment?: string;
  @DateField(false, true) createdAt?: string;
}
export class ProgressEntryDto extends UpdateTaskProgressDto {
  @TaskNumberField() taskNumber!: number;
  @EnumField(PROGRESS_MASTERY_LEVEL, false, true) lastAssessedMasteryLevel?: string | null;
  @IntegerField() lessonCount?: number;
  @TextField() lastLessonId?: string;
  @DateField(false, true) lastActivityAt?: string;
  @DateField(false, true) lastAssessedAt?: string;
  @EnumField(PROGRESS_SOURCE) source?: string;
  @NestedArrayField(ProgressHistoryEntryDto) history?: ProgressHistoryEntryDto[];
}
export class ReplaceProgressDto {
  @NestedArrayField(ProgressEntryDto, true, 25)
  @ArrayUnique((item: ProgressEntryDto) => item.taskNumber)
  progressByTask!: ProgressEntryDto[];
}
