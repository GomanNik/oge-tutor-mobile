import { PartialType } from '@nestjs/swagger';
import { AttachmentDto } from '../common/attachment.dto';
import { LESSON_SOURCE, LESSON_STATUS } from '../common/contracts';
import { DateField, EnumField, NestedArrayField, RequiredText, TaskNumbersField, TextField } from '../common/dto-fields';

export class CreateLessonDto {
  @RequiredText() studentId!: string;
  @RequiredText() topic!: string;
  @TaskNumbersField() focusTaskNumbers?: number[];
  @DateField(true) startAt!: string;
  @DateField(true) endAt!: string;
  @TextField() timezone?: string;
  @EnumField(LESSON_SOURCE) source?: string;
  @TextField() note?: string;
  @NestedArrayField(AttachmentDto) materials?: AttachmentDto[];
}
export class UpdateLessonDto extends PartialType(CreateLessonDto, { skipNullProperties: false }) {
  @EnumField(LESSON_STATUS) status?: string;
}
export class CompleteLessonDto {
  @TaskNumbersField() focusTaskNumbers?: number[];
  @TextField() completionComment?: string;
  @TextField(false, { description: 'Alias for completionComment.' }) comment?: string;
}
