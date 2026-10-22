import { BooleanField, NestedField } from './dto-fields';

export class NotificationPreferencesDto {
  @BooleanField() lessonReminders?: boolean;
  @BooleanField() homeworkDeadlines?: boolean;
  @BooleanField() homeworkReviewed?: boolean;
  @BooleanField() newMaterials?: boolean;
  @BooleanField() submittedSolutions?: boolean;
  @BooleanField() overdueHomework?: boolean;
  @BooleanField() studentAccessProblems?: boolean;
}
export class SettingsDto {
  @NestedField(NotificationPreferencesDto) notifications?: NotificationPreferencesDto;
}
