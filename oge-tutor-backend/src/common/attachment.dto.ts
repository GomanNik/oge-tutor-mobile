import { MATERIAL_SOURCE, MATERIAL_TYPE } from './contracts';
import { DateField, EnumField, IntegerField, NestedField, RequiredText, TextField } from './dto-fields';

export class FileResourceInputDto {
  @RequiredText() id!: string;
  @TextField() originalName?: string;
  @TextField() mimeType?: string;
  @IntegerField() size?: number;
  @TextField() url?: string;
  @DateField(false, true) uploadedAt?: string;
}

export class AttachmentDto {
  @TextField() id?: string;
  @EnumField(MATERIAL_TYPE) type?: string;
  @EnumField(MATERIAL_SOURCE) source?: string;
  @TextField() title?: string;
  @TextField() url?: string;
  @TextField() fileId?: string;
  @TextField() originalName?: string;
  @TextField() fileName?: string;
  @TextField() mimeType?: string;
  @IntegerField() size?: number;
  @DateField(false, true) uploadedAt?: string;
  @NestedField(FileResourceInputDto) fileResource?: FileResourceInputDto;
}
