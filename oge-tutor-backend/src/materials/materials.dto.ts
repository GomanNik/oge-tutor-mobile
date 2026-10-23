import { PartialType } from '@nestjs/swagger';
import { AttachmentDto } from '../common/attachment.dto';
import { MATERIAL_TYPE } from '../common/contracts';
import { EnumField, NestedField, TaskNumberField, TextField } from '../common/dto-fields';

export class AddMaterialDto {
  @TaskNumberField() taskNumber!: number;
  @TextField() topicTitle?: string;
  @EnumField(MATERIAL_TYPE, true) type!: string;
  @TextField() fileId?: string;
  @TextField() url?: string;
  @TextField() title?: string;
  @TextField() fileName?: string;
  @NestedField(AttachmentDto) item?: AttachmentDto;
}
export class UpdateMaterialFileDto extends PartialType(AddMaterialDto, { skipNullProperties: false }) {}
