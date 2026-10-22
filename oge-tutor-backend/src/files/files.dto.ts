import { TextField } from '../common/dto-fields';

export class UploadFileMetaDto {
  @TextField() title?: string;
  @TextField(false, { description: 'Upload context, including material-library, material-library-replace, homework-submission, and attachment contexts.' }) context?: string;
}
