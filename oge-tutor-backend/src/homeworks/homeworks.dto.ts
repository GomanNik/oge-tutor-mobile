import { PartialType } from '@nestjs/swagger';
import { AttachmentDto } from '../common/attachment.dto';
import { HOMEWORK_REVIEW_ACTION, HOMEWORK_STATUS } from '../common/contracts';
import { DateField, EnumField, NestedArrayField, RequiredText, TaskNumbersField, TextField } from '../common/dto-fields';

export class CreateHomeworkDto {
  @RequiredText() studentId!: string;
  @RequiredText() title!: string;
  @TextField() description?: string;
  @TextField() topic?: string;
  @TaskNumbersField(true) taskNumbers!: number[];
  @DateField(true) dueAt!: string;
  @NestedArrayField(AttachmentDto) materials?: AttachmentDto[];
}
export class UpdateHomeworkDto extends PartialType(CreateHomeworkDto, { skipNullProperties: false }) {
  @EnumField(HOMEWORK_STATUS) status?: string;
}
export class ReviewHomeworkDto {
  @EnumField([HOMEWORK_STATUS.REVIEWED, HOMEWORK_STATUS.NEEDS_REVISION]) status?: string;
  @EnumField(HOMEWORK_REVIEW_ACTION) action?: string;
  @EnumField(HOMEWORK_REVIEW_ACTION) reviewAction?: string;
  @TextField(false, { description: 'Alias for teacherComment.' }) comment?: string;
  @TextField() teacherComment?: string;
  @NestedArrayField(AttachmentDto) reviewMaterials?: AttachmentDto[];
}
export class SubmitHomeworkDto {
  @TextField() fileTitle?: string;
}
