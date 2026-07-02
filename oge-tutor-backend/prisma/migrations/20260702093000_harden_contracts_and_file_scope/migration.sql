-- CreateEnum
CREATE TYPE "Role" AS ENUM ('teacher', 'student');
CREATE TYPE "AccessTokenType" AS ENUM ('invite', 'password_reset');
CREATE TYPE "AccessStatus" AS ENUM ('active', 'invite_sent', 'password_pending', 'disabled');
CREATE TYPE "LessonStatus" AS ENUM ('planned', 'rescheduled', 'completed', 'canceled');
CREATE TYPE "LessonSource" AS ENUM ('manual', 'template', 'import');
CREATE TYPE "HomeworkStatus" AS ENUM ('assigned', 'submitted', 'needs_revision', 'reviewed', 'overdue');
CREATE TYPE "SubmissionStatus" AS ENUM ('submitted', 'reviewed', 'needs_revision');
CREATE TYPE "FileScope" AS ENUM ('private_upload', 'private_submission', 'teacher_material', 'shared_material');
CREATE TYPE "MaterialType" AS ENUM ('file', 'link', 'library');
CREATE TYPE "MaterialSource" AS ENUM ('upload', 'link', 'library');
CREATE TYPE "ProgressCoverageStatus" AS ENUM ('not_started', 'in_progress', 'assessment_needed', 'assessed');
CREATE TYPE "ProgressMasteryLevel" AS ENUM ('weak', 'medium', 'good', 'strong');
CREATE TYPE "ProgressSource" AS ENUM ('manual', 'lesson_completed', 'homework_result', 'diagnostic', 'import');
CREATE TYPE "NotificationType" AS ENUM ('progress_assessment_required');
CREATE TYPE "NotificationStatus" AS ENUM ('unread', 'read', 'resolved');

-- Student teacher-private note contract
ALTER TABLE "StudentProfile" ADD COLUMN "note" TEXT NOT NULL DEFAULT '';

-- File ownership and scope hardening
ALTER TABLE "FileResource" DROP CONSTRAINT "FileResource_ownerId_fkey";
DELETE FROM "MaterialAttachment" WHERE "fileId" IN (SELECT "id" FROM "FileResource" WHERE "ownerId" IS NULL);
DELETE FROM "HomeworkSubmission" WHERE "fileResourceId" IN (SELECT "id" FROM "FileResource" WHERE "ownerId" IS NULL);
DELETE FROM "FileResource" WHERE "ownerId" IS NULL;
ALTER TABLE "FileResource" ADD COLUMN "scope" "FileScope" NOT NULL DEFAULT 'private_upload';
UPDATE "FileResource"
SET "scope" = 'private_submission'
WHERE "id" IN (SELECT "fileResourceId" FROM "HomeworkSubmission");
UPDATE "FileResource"
SET "scope" = 'teacher_material'
WHERE "ownerId" IN (
  SELECT "userId" FROM "TeacherProfile"
);
ALTER TABLE "FileResource" ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "FileResource" ADD CONSTRAINT "FileResource_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Convert string contract columns to database enums without changing external JSON values
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role" USING ("role"::"Role");

ALTER TABLE "AccessToken" ALTER COLUMN "type" TYPE "AccessTokenType" USING ("type"::"AccessTokenType");

ALTER TABLE "StudentProfile" ALTER COLUMN "access" DROP DEFAULT;
ALTER TABLE "StudentProfile" ALTER COLUMN "access" TYPE "AccessStatus" USING ("access"::"AccessStatus");
ALTER TABLE "StudentProfile" ALTER COLUMN "access" SET DEFAULT 'password_pending';

ALTER TABLE "Lesson" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Lesson" ALTER COLUMN "source" DROP DEFAULT;
ALTER TABLE "Lesson" ALTER COLUMN "status" TYPE "LessonStatus" USING ("status"::"LessonStatus");
ALTER TABLE "Lesson" ALTER COLUMN "source" TYPE "LessonSource" USING ("source"::"LessonSource");
ALTER TABLE "Lesson" ALTER COLUMN "status" SET DEFAULT 'planned';
ALTER TABLE "Lesson" ALTER COLUMN "source" SET DEFAULT 'manual';

ALTER TABLE "Homework" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Homework" ALTER COLUMN "status" TYPE "HomeworkStatus" USING ("status"::"HomeworkStatus");
ALTER TABLE "Homework" ALTER COLUMN "status" SET DEFAULT 'assigned';

ALTER TABLE "HomeworkSubmission" ALTER COLUMN "reviewStatus" DROP DEFAULT;
ALTER TABLE "HomeworkSubmission" ALTER COLUMN "reviewStatus" TYPE "SubmissionStatus" USING ("reviewStatus"::"SubmissionStatus");
ALTER TABLE "HomeworkSubmission" ALTER COLUMN "reviewStatus" SET DEFAULT 'submitted';

ALTER TABLE "MaterialAttachment" ALTER COLUMN "type" TYPE "MaterialType" USING ("type"::"MaterialType");
ALTER TABLE "MaterialAttachment" ALTER COLUMN "source" TYPE "MaterialSource" USING ("source"::"MaterialSource");

ALTER TABLE "StudentTaskProgress" ALTER COLUMN "coverageStatus" DROP DEFAULT;
ALTER TABLE "StudentTaskProgress" ALTER COLUMN "source" DROP DEFAULT;
ALTER TABLE "StudentTaskProgress" ALTER COLUMN "coverageStatus" TYPE "ProgressCoverageStatus" USING ("coverageStatus"::"ProgressCoverageStatus");
ALTER TABLE "StudentTaskProgress" ALTER COLUMN "masteryLevel" TYPE "ProgressMasteryLevel" USING ("masteryLevel"::"ProgressMasteryLevel");
ALTER TABLE "StudentTaskProgress" ALTER COLUMN "lastAssessedMasteryLevel" TYPE "ProgressMasteryLevel" USING ("lastAssessedMasteryLevel"::"ProgressMasteryLevel");
ALTER TABLE "StudentTaskProgress" ALTER COLUMN "source" TYPE "ProgressSource" USING ("source"::"ProgressSource");
ALTER TABLE "StudentTaskProgress" ALTER COLUMN "coverageStatus" SET DEFAULT 'not_started';
ALTER TABLE "StudentTaskProgress" ALTER COLUMN "source" SET DEFAULT 'manual';

DELETE FROM "ProgressHistory" WHERE NOT EXISTS (
  SELECT 1 FROM "StudentProfile" WHERE "StudentProfile"."id" = "ProgressHistory"."studentId"
);
ALTER TABLE "ProgressHistory" ALTER COLUMN "source" TYPE "ProgressSource" USING ("source"::"ProgressSource");
ALTER TABLE "ProgressHistory" ALTER COLUMN "coverageStatus" TYPE "ProgressCoverageStatus" USING ("coverageStatus"::"ProgressCoverageStatus");
ALTER TABLE "ProgressHistory" ALTER COLUMN "masteryLevel" TYPE "ProgressMasteryLevel" USING ("masteryLevel"::"ProgressMasteryLevel");
ALTER TABLE "ProgressHistory" ADD CONSTRAINT "ProgressHistory_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Notification" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Notification" ALTER COLUMN "type" TYPE "NotificationType" USING ("type"::"NotificationType");
ALTER TABLE "Notification" ALTER COLUMN "status" TYPE "NotificationStatus" USING ("status"::"NotificationStatus");
ALTER TABLE "Notification" ALTER COLUMN "status" SET DEFAULT 'unread';

-- Query indexes for common teacher/student/status/file/token paths
CREATE INDEX "User_role_idx" ON "User"("role");
CREATE INDEX "AccessToken_type_expiresAt_idx" ON "AccessToken"("type", "expiresAt");
CREATE INDEX "AccessToken_usedAt_idx" ON "AccessToken"("usedAt");
CREATE INDEX "StudentProfile_teacherId_access_idx" ON "StudentProfile"("teacherId", "access");
CREATE INDEX "StudentProfile_access_idx" ON "StudentProfile"("access");
CREATE INDEX "Lesson_teacherId_status_startAt_idx" ON "Lesson"("teacherId", "status", "startAt");
CREATE INDEX "Lesson_studentId_status_startAt_idx" ON "Lesson"("studentId", "status", "startAt");
CREATE INDEX "Homework_teacherId_status_dueAt_idx" ON "Homework"("teacherId", "status", "dueAt");
CREATE INDEX "Homework_studentId_status_dueAt_idx" ON "Homework"("studentId", "status", "dueAt");
CREATE INDEX "HomeworkSubmission_fileResourceId_idx" ON "HomeworkSubmission"("fileResourceId");
CREATE INDEX "FileResource_ownerId_idx" ON "FileResource"("ownerId");
CREATE INDEX "FileResource_scope_idx" ON "FileResource"("scope");
CREATE INDEX "FileResource_uploadedAt_idx" ON "FileResource"("uploadedAt");
CREATE INDEX "MaterialAttachment_fileId_idx" ON "MaterialAttachment"("fileId");
CREATE INDEX "ProgressHistory_studentId_createdAt_idx" ON "ProgressHistory"("studentId", "createdAt");
CREATE INDEX "ProgressHistory_lessonId_idx" ON "ProgressHistory"("lessonId");
CREATE INDEX "Notification_teacherId_status_idx" ON "Notification"("teacherId", "status");
CREATE INDEX "Notification_studentId_status_idx" ON "Notification"("studentId", "status");
CREATE INDEX "Notification_lessonId_idx" ON "Notification"("lessonId");
