-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('draft', 'published', 'closed', 'archived');

-- CreateEnum
CREATE TYPE "AssignmentRecipientStatus" AS ENUM ('assigned', 'submitted', 'needs_revision', 'reviewed', 'exempted', 'closed');

-- CreateEnum
CREATE TYPE "AssignmentReviewStatus" AS ENUM ('draft', 'published');

-- CreateEnum
CREATE TYPE "AssignmentReviewDecision" AS ENUM ('accepted', 'rework');

-- AlterTable
ALTER TABLE "FileResource" ADD COLUMN     "checksum" TEXT,
ADD COLUMN     "workspaceId" TEXT;

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT NOT NULL DEFAULT '',
    "taskDefinitionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "taskSnapshot" JSONB NOT NULL DEFAULT '[]',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'draft',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closeReason" TEXT NOT NULL DEFAULT '',
    "legacyHomeworkId" TEXT,
    "legacyState" JSONB NOT NULL DEFAULT '{}',
    "legacyMaterials" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentFile" (
    "assignmentId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,

    CONSTRAINT "AssignmentFile_pkey" PRIMARY KEY ("assignmentId","fileId")
);

-- CreateTable
CREATE TABLE "AssignmentRecipient" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "AssignmentRecipientStatus" NOT NULL DEFAULT 'assigned',
    "reason" TEXT NOT NULL DEFAULT '',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssignmentRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentSubmission" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "contentSnapshot" JSONB NOT NULL,
    "legacySubmissionId" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssignmentSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentSubmissionFile" (
    "submissionId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,

    CONSTRAINT "AssignmentSubmissionFile_pkey" PRIMARY KEY ("submissionId","fileId")
);

-- CreateTable
CREATE TABLE "AssignmentReview" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "status" "AssignmentReviewStatus" NOT NULL DEFAULT 'draft',
    "decision" "AssignmentReviewDecision" NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "scores" JSONB NOT NULL DEFAULT '[]',
    "reason" TEXT NOT NULL DEFAULT '',
    "reviewerUserId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'user',
    "legacyMaterials" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "AssignmentReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentReviewFile" (
    "reviewId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,

    CONSTRAINT "AssignmentReviewFile_pkey" PRIMARY KEY ("reviewId","fileId")
);

-- CreateTable
CREATE TABLE "LearningMaterial" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "programVersionId" TEXT NOT NULL,
    "taskDefinitionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL DEFAULT '',
    "fileId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "legacyAttachmentId" TEXT,
    "legacyState" JSONB NOT NULL DEFAULT '{}',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialPublication" (
    "id" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "lessonId" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MaterialPublication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialPublicationRecipient" (
    "publicationId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,

    CONSTRAINT "MaterialPublicationRecipient_pkey" PRIMARY KEY ("publicationId","enrollmentId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Assignment_legacyHomeworkId_key" ON "Assignment"("legacyHomeworkId");

-- CreateIndex
CREATE INDEX "Assignment_courseId_status_dueAt_id_idx" ON "Assignment"("courseId", "status", "dueAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Assignment_id_courseId_key" ON "Assignment"("id", "courseId");

-- CreateIndex
CREATE INDEX "AssignmentFile_fileId_idx" ON "AssignmentFile"("fileId");

-- CreateIndex
CREATE INDEX "AssignmentRecipient_enrollmentId_status_dueAt_idx" ON "AssignmentRecipient"("enrollmentId", "status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentRecipient_assignmentId_enrollmentId_key" ON "AssignmentRecipient"("assignmentId", "enrollmentId");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentSubmission_legacySubmissionId_key" ON "AssignmentSubmission"("legacySubmissionId");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentSubmission_recipientId_attempt_key" ON "AssignmentSubmission"("recipientId", "attempt");

-- CreateIndex
CREATE INDEX "AssignmentSubmissionFile_fileId_idx" ON "AssignmentSubmissionFile"("fileId");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentReview_submissionId_number_key" ON "AssignmentReview"("submissionId", "number");

-- CreateIndex
CREATE INDEX "AssignmentReviewFile_fileId_idx" ON "AssignmentReviewFile"("fileId");

-- CreateIndex
CREATE UNIQUE INDEX "LearningMaterial_legacyAttachmentId_key" ON "LearningMaterial"("legacyAttachmentId");

-- CreateIndex
CREATE INDEX "LearningMaterial_workspaceId_programVersionId_archivedAt_cr_idx" ON "LearningMaterial"("workspaceId", "programVersionId", "archivedAt", "createdAt", "id");

-- CreateIndex
CREATE INDEX "MaterialPublication_courseId_revokedAt_idx" ON "MaterialPublication"("courseId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialPublication_id_courseId_key" ON "MaterialPublication"("id", "courseId");

-- CreateIndex
CREATE INDEX "MaterialPublicationRecipient_enrollmentId_idx" ON "MaterialPublicationRecipient"("enrollmentId");

-- CreateIndex
CREATE INDEX "FileResource_workspaceId_ownerId_idx" ON "FileResource"("workspaceId", "ownerId");

-- AddForeignKey
ALTER TABLE "FileResource" ADD CONSTRAINT "FileResource_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentFile" ADD CONSTRAINT "AssignmentFile_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentFile" ADD CONSTRAINT "AssignmentFile_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileResource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentRecipient" ADD CONSTRAINT "AssignmentRecipient_assignmentId_courseId_fkey" FOREIGN KEY ("assignmentId", "courseId") REFERENCES "Assignment"("id", "courseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentRecipient" ADD CONSTRAINT "AssignmentRecipient_enrollmentId_courseId_fkey" FOREIGN KEY ("enrollmentId", "courseId") REFERENCES "Enrollment"("id", "courseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentSubmission" ADD CONSTRAINT "AssignmentSubmission_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "AssignmentRecipient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentSubmissionFile" ADD CONSTRAINT "AssignmentSubmissionFile_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "AssignmentSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentSubmissionFile" ADD CONSTRAINT "AssignmentSubmissionFile_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileResource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentReview" ADD CONSTRAINT "AssignmentReview_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "AssignmentSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentReview" ADD CONSTRAINT "AssignmentReview_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentReviewFile" ADD CONSTRAINT "AssignmentReviewFile_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "AssignmentReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentReviewFile" ADD CONSTRAINT "AssignmentReviewFile_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileResource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningMaterial" ADD CONSTRAINT "LearningMaterial_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningMaterial" ADD CONSTRAINT "LearningMaterial_programVersionId_fkey" FOREIGN KEY ("programVersionId") REFERENCES "ProgramVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningMaterial" ADD CONSTRAINT "LearningMaterial_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileResource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningMaterial" ADD CONSTRAINT "LearningMaterial_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialPublication" ADD CONSTRAINT "MaterialPublication_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "LearningMaterial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialPublication" ADD CONSTRAINT "MaterialPublication_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialPublication" ADD CONSTRAINT "MaterialPublication_lessonId_courseId_fkey" FOREIGN KEY ("lessonId", "courseId") REFERENCES "Lesson"("id", "courseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialPublicationRecipient" ADD CONSTRAINT "MaterialPublicationRecipient_publicationId_courseId_fkey" FOREIGN KEY ("publicationId", "courseId") REFERENCES "MaterialPublication"("id", "courseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialPublicationRecipient" ADD CONSTRAINT "MaterialPublicationRecipient_enrollmentId_courseId_fkey" FOREIGN KEY ("enrollmentId", "courseId") REFERENCES "Enrollment"("id", "courseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every historical homework must have the unambiguous course introduced in block 3.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM "Homework" h
    LEFT JOIN "LegacyCourseMapping" m ON m."studentProfileId" = h."studentId"
    LEFT JOIN "StudentProfile" s ON s.id = h."studentId"
    WHERE m."courseId" IS NULL OR s."teacherId" <> h."teacherId"
  ) THEN RAISE EXCEPTION 'Legacy homework has no matching course or teacher; repair before migration'; END IF;
END $$;

CREATE FUNCTION prune_legacy_material_visibility(teacher_id TEXT, student_id TEXT) RETURNS void AS $$
DECLARE mapped_course TEXT;
BEGIN
  SELECT m."courseId" INTO mapped_course FROM "LegacyCourseMapping" m
    WHERE m."studentProfileId" = student_id;
  IF mapped_course IS NULL THEN RETURN; END IF;
  UPDATE "MaterialPublication" publication SET "revokedAt" = CURRENT_TIMESTAMP, revision = publication.revision + 1
  FROM "LearningMaterial" material
    JOIN "MaterialAttachment" attachment ON attachment.id = material."legacyAttachmentId"
    JOIN "MaterialTopic" topic ON topic.id = attachment."topicId"
  WHERE publication."materialId" = material.id AND publication."courseId" = mapped_course
    AND publication."revokedAt" IS NULL AND topic."teacherId" = teacher_id
    AND NOT EXISTS (SELECT 1 FROM "Homework" homework WHERE homework."teacherId" = teacher_id
      AND homework."studentId" = student_id AND topic."taskNumber" = ANY(homework."taskNumbers"))
    AND NOT EXISTS (SELECT 1 FROM "Lesson" lesson WHERE lesson."teacherId" = teacher_id
      AND lesson."studentId" = student_id AND topic."taskNumber" = ANY(lesson."focusTaskNumbers"));
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION sync_legacy_homework() RETURNS trigger AS $$
DECLARE mapped RECORD; selected_ids TEXT[]; selected_tasks JSONB;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."studentId" <> OLD."studentId" THEN
    RAISE EXCEPTION 'Published homework recipient cannot be reassigned';
  END IF;
  SELECT m."courseId", m."enrollmentId", c."programVersionId"
    INTO mapped FROM "LegacyCourseMapping" m JOIN "Course" c ON c.id = m."courseId"
    WHERE m."studentProfileId" = NEW."studentId";
  IF mapped."courseId" IS NULL THEN RAISE EXCEPTION 'Legacy homework requires a mapped course'; END IF;
  SELECT COALESCE(array_agg(t.id ORDER BY t.position), ARRAY[]::TEXT[]),
         COALESCE(jsonb_agg(jsonb_build_object('id', t.id, 'code', t.code, 'title', t.title,
           'maxScore', t."maxScore", 'criteria', t.criteria) ORDER BY t.position), '[]'::jsonb)
    INTO selected_ids, selected_tasks
    FROM "TaskDefinition" t WHERE t."programVersionId" = mapped."programVersionId" AND t.position = ANY(NEW."taskNumbers");
  INSERT INTO "Assignment" (id, "courseId", title, instructions, "taskDefinitionIds", "taskSnapshot",
    "dueAt", status, "publishedAt", "closedAt", "legacyHomeworkId", "legacyState", "legacyMaterials", "createdAt", "updatedAt")
  VALUES ('legacy-assignment-' || NEW.id, mapped."courseId", NEW.title, NEW.description,
    selected_ids, selected_tasks, NEW."dueAt", 'published', NEW."assignedAt", NEW."closedAt", NEW.id,
    jsonb_build_object('topic', NEW.topic, 'taskNumbers', NEW."taskNumbers", 'status', NEW.status,
      'assignedAt', NEW."assignedAt", 'submittedAt', NEW."submittedAt", 'reviewedAt', NEW."reviewedAt",
      'closedAt', NEW."closedAt", 'solutionFile', NEW."solutionFile", 'teacherComment', NEW."teacherComment",
      'reviewMaterials', NEW."reviewMaterials"), NEW.materials, NEW."createdAt", NEW."updatedAt")
  ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, instructions = EXCLUDED.instructions,
    "taskDefinitionIds" = EXCLUDED."taskDefinitionIds", "taskSnapshot" = EXCLUDED."taskSnapshot",
    "dueAt" = EXCLUDED."dueAt", "closedAt" = EXCLUDED."closedAt", "legacyState" = EXCLUDED."legacyState",
    "legacyMaterials" = EXCLUDED."legacyMaterials", revision = "Assignment".revision + 1, "updatedAt" = EXCLUDED."updatedAt";
  INSERT INTO "AssignmentRecipient" (id, "assignmentId", "courseId", "enrollmentId", "dueAt", status, "createdAt", "updatedAt")
  VALUES ('legacy-recipient-' || NEW.id, 'legacy-assignment-' || NEW.id, mapped."courseId", mapped."enrollmentId", NEW."dueAt",
    CASE NEW.status WHEN 'submitted' THEN 'submitted'::"AssignmentRecipientStatus"
      WHEN 'needs_revision' THEN 'needs_revision'::"AssignmentRecipientStatus"
      WHEN 'reviewed' THEN 'reviewed'::"AssignmentRecipientStatus" ELSE 'assigned'::"AssignmentRecipientStatus" END,
    NEW."assignedAt", NEW."updatedAt")
  ON CONFLICT (id) DO UPDATE SET "dueAt" = EXCLUDED."dueAt", status = EXCLUDED.status,
    revision = "AssignmentRecipient".revision + 1, "updatedAt" = EXCLUDED."updatedAt";
  DELETE FROM "AssignmentFile" WHERE "assignmentId" = 'legacy-assignment-' || NEW.id;
  INSERT INTO "AssignmentFile" ("assignmentId", "fileId")
  SELECT 'legacy-assignment-' || NEW.id, f.id FROM jsonb_array_elements(
    CASE WHEN jsonb_typeof(NEW.materials) = 'array' THEN NEW.materials ELSE '[]'::jsonb END) j
    JOIN "FileResource" f ON f.id = j->>'fileId' ON CONFLICT DO NOTHING;
  INSERT INTO "MaterialPublication" (id, "materialId", "courseId", "publishedAt")
  SELECT 'legacy-material-publication-' || a.id || '-' || mapped."courseId", 'legacy-material-' || a.id,
    mapped."courseId", a."createdAt"
  FROM "MaterialAttachment" a JOIN "MaterialTopic" topic ON topic.id = a."topicId"
  JOIN "LearningMaterial" material ON material."legacyAttachmentId" = a.id
  WHERE topic."teacherId" = NEW."teacherId" AND topic."taskNumber" = ANY(NEW."taskNumbers")
    AND material."archivedAt" IS NULL
  ON CONFLICT (id) DO UPDATE SET "revokedAt" = NULL, revision = "MaterialPublication".revision + 1
    WHERE "MaterialPublication"."revokedAt" IS NOT NULL;
  INSERT INTO "MaterialPublicationRecipient" ("publicationId", "courseId", "enrollmentId")
  SELECT p.id, mapped."courseId", mapped."enrollmentId" FROM "MaterialPublication" p
  WHERE p."courseId" = mapped."courseId" AND p."revokedAt" IS NULL
    AND p."materialId" IN (SELECT material.id FROM "LearningMaterial" material
      JOIN "MaterialAttachment" a ON a.id = material."legacyAttachmentId"
      JOIN "MaterialTopic" topic ON topic.id = a."topicId"
      WHERE topic."teacherId" = NEW."teacherId" AND topic."taskNumber" = ANY(NEW."taskNumbers"))
  ON CONFLICT DO NOTHING;
  PERFORM prune_legacy_material_visibility(NEW."teacherId", NEW."studentId");
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "Homework_assignment_sync" AFTER INSERT OR UPDATE ON "Homework" FOR EACH ROW EXECUTE FUNCTION sync_legacy_homework();
UPDATE "Homework" SET "updatedAt" = "updatedAt";

CREATE FUNCTION sync_legacy_submission() RETURNS trigger AS $$
DECLARE h RECORD; next_attempt INTEGER; current_review INTEGER; review_id TEXT;
BEGIN
  SELECT hw.*, a.id AS "assignmentId" INTO h FROM "Homework" hw
    JOIN "Assignment" a ON a."legacyHomeworkId" = hw.id WHERE hw.id = NEW."homeworkId";
  IF h.id IS NULL OR NEW."studentId" <> h."studentId" THEN
    RAISE EXCEPTION 'Legacy submission has no matching assignment and student';
  END IF;
  SELECT COALESCE(MAX(attempt), 0) + 1 INTO next_attempt FROM "AssignmentSubmission"
    WHERE "recipientId" = 'legacy-recipient-' || NEW."homeworkId";
  INSERT INTO "AssignmentSubmission" (id, "recipientId", attempt, text, "contentSnapshot", "legacySubmissionId", "submittedAt")
  VALUES ('legacy-submission-' || NEW.id, 'legacy-recipient-' || NEW."homeworkId", next_attempt, '',
    jsonb_build_object('title', h.title, 'instructions', h.description, 'taskNumbers', h."taskNumbers",
      'materials', h.materials, 'dueAt', h."dueAt"), NEW.id, NEW."submittedAt")
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO "AssignmentSubmissionFile" ("submissionId", "fileId")
    VALUES ('legacy-submission-' || NEW.id, NEW."fileResourceId") ON CONFLICT DO NOTHING;
  IF NEW."reviewedAt" IS NOT NULL AND NEW."reviewStatus" <> 'submitted'
    AND NOT EXISTS (SELECT 1 FROM "AssignmentReview" WHERE "submissionId" = 'legacy-submission-' || NEW.id) THEN
    SELECT COALESCE(MAX(number), 0) + 1 INTO current_review FROM "AssignmentReview" WHERE "submissionId" = 'legacy-submission-' || NEW.id;
    review_id := 'legacy-review-' || NEW.id || '-' || current_review;
    INSERT INTO "AssignmentReview" (id, "submissionId", number, status, decision, comment, scores,
      "reviewerUserId", source, "legacyMaterials", "createdAt", "publishedAt")
    VALUES (review_id, 'legacy-submission-' || NEW.id, current_review, 'published',
      CASE NEW."reviewStatus" WHEN 'reviewed' THEN 'accepted'::"AssignmentReviewDecision" ELSE 'rework'::"AssignmentReviewDecision" END,
      NEW."teacherComment", '[]', NULL, 'legacy', h."reviewMaterials", NEW."reviewedAt", NEW."reviewedAt");
    INSERT INTO "AssignmentReviewFile" ("reviewId", "fileId")
      SELECT review_id, f.id FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(h."reviewMaterials") = 'array' THEN h."reviewMaterials" ELSE '[]'::jsonb END) j
        JOIN "FileResource" f ON f.id = j->>'fileId' ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "HomeworkSubmission_assignment_sync" AFTER INSERT OR UPDATE ON "HomeworkSubmission"
  FOR EACH ROW EXECUTE FUNCTION sync_legacy_submission();
DO $$ DECLARE item RECORD; BEGIN
  FOR item IN SELECT id FROM "HomeworkSubmission" ORDER BY "submittedAt", id LOOP
    UPDATE "HomeworkSubmission" SET "submittedAt" = "submittedAt" WHERE id = item.id;
  END LOOP;
END $$;

CREATE FUNCTION protect_assignment_submission() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Submission history is immutable';
END;
$$ LANGUAGE plpgsql;
CREATE FUNCTION protect_assignment_review() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'published' THEN RAISE EXCEPTION 'Published review is immutable'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE FUNCTION protect_assignment_content() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'draft' AND OLD."legacyHomeworkId" IS NULL
    AND (OLD.title, OLD.instructions, OLD."taskDefinitionIds", OLD."taskSnapshot", OLD."dueAt")
      IS DISTINCT FROM (NEW.title, NEW.instructions, NEW."taskDefinitionIds", NEW."taskSnapshot", NEW."dueAt")
    THEN RAISE EXCEPTION 'Published assignment content is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "Assignment_content_immutable" BEFORE UPDATE ON "Assignment" FOR EACH ROW EXECUTE FUNCTION protect_assignment_content();
CREATE TRIGGER "AssignmentSubmission_immutable" BEFORE UPDATE ON "AssignmentSubmission" FOR EACH ROW EXECUTE FUNCTION protect_assignment_submission();
CREATE TRIGGER "AssignmentReview_published_immutable" BEFORE UPDATE ON "AssignmentReview" FOR EACH ROW EXECUTE FUNCTION protect_assignment_review();

-- The old topic library was implicitly shared by assigned task number. Imported
-- publications record the actual legacy enrollment instead of broad workspace access.
CREATE FUNCTION sync_legacy_material() RETURNS trigger AS $$
DECLARE topic_row RECORD; task_id TEXT; current_course RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE "LearningMaterial" SET "archivedAt" = CURRENT_TIMESTAMP, revision = revision + 1
      WHERE "legacyAttachmentId" = OLD.id;
    UPDATE "MaterialPublication" SET "revokedAt" = CURRENT_TIMESTAMP, revision = revision + 1
      WHERE "materialId" = 'legacy-material-' || OLD.id AND "revokedAt" IS NULL;
    RETURN OLD;
  END IF;
  SELECT topic."teacherId", topic."taskNumber", lm."workspaceId", t."userId"
    INTO topic_row FROM "MaterialTopic" topic
    JOIN "LegacyWorkspaceMapping" lm ON lm."teacherProfileId" = topic."teacherId"
    JOIN "TeacherProfile" t ON t.id = topic."teacherId" WHERE topic.id = NEW."topicId";
  IF topic_row."workspaceId" IS NULL THEN RAISE EXCEPTION 'Legacy material has no teacher workspace'; END IF;
  SELECT id INTO task_id FROM "TaskDefinition" WHERE "programVersionId" = 'legacy-version-oge-math'
    AND position = topic_row."taskNumber" LIMIT 1;
  INSERT INTO "LearningMaterial" (id, "workspaceId", "programVersionId", "taskDefinitionIds", title, description,
    url, "fileId", "createdByUserId", "legacyAttachmentId", "legacyState", "createdAt", "updatedAt")
  VALUES ('legacy-material-' || NEW.id, topic_row."workspaceId", 'legacy-version-oge-math',
    CASE WHEN task_id IS NULL THEN ARRAY[]::TEXT[] ELSE ARRAY[task_id] END,
    NEW.title, '', CASE WHEN NEW."fileId" IS NULL THEN NEW.url ELSE '' END, NEW."fileId",
    topic_row."userId", NEW.id, jsonb_build_object('type', NEW.type, 'source', NEW.source,
      'url', NEW.url, 'originalName', NEW."originalName", 'fileName', NEW."fileName", 'mimeType', NEW."mimeType",
      'size', NEW.size, 'taskNumber', topic_row."taskNumber"), NEW."createdAt", CURRENT_TIMESTAMP)
  ON CONFLICT (id) DO UPDATE SET "taskDefinitionIds" = EXCLUDED."taskDefinitionIds", title = EXCLUDED.title,
    url = EXCLUDED.url, "fileId" = EXCLUDED."fileId", "legacyState" = EXCLUDED."legacyState",
    "archivedAt" = NULL, revision = "LearningMaterial".revision + 1, "updatedAt" = CURRENT_TIMESTAMP;
  IF TG_OP = 'UPDATE' AND NEW."topicId" <> OLD."topicId" THEN
    UPDATE "MaterialPublication" SET "revokedAt" = CURRENT_TIMESTAMP, revision = revision + 1
      WHERE "materialId" = 'legacy-material-' || NEW.id AND "revokedAt" IS NULL;
  END IF;
  FOR current_course IN
    SELECT m."courseId", m."enrollmentId" FROM "LegacyCourseMapping" m
    JOIN "StudentProfile" s ON s.id = m."studentProfileId"
    WHERE s."teacherId" = topic_row."teacherId" AND (
      EXISTS (SELECT 1 FROM "Homework" h WHERE h."studentId" = s.id AND topic_row."taskNumber" = ANY(h."taskNumbers"))
      OR EXISTS (SELECT 1 FROM "Lesson" l WHERE l."studentId" = s.id AND l."teacherId" = topic_row."teacherId"
        AND topic_row."taskNumber" = ANY(l."focusTaskNumbers")))
  LOOP
    INSERT INTO "MaterialPublication" (id, "materialId", "courseId", "publishedAt")
      VALUES ('legacy-material-publication-' || NEW.id || '-' || current_course."courseId",
        'legacy-material-' || NEW.id, current_course."courseId", NEW."createdAt")
      ON CONFLICT (id) DO UPDATE SET "revokedAt" = NULL, revision = "MaterialPublication".revision + 1
        WHERE "MaterialPublication"."revokedAt" IS NOT NULL;
    INSERT INTO "MaterialPublicationRecipient" ("publicationId", "courseId", "enrollmentId")
      VALUES ('legacy-material-publication-' || NEW.id || '-' || current_course."courseId",
        current_course."courseId", current_course."enrollmentId") ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "MaterialAttachment_learning_sync" AFTER INSERT OR UPDATE OR DELETE ON "MaterialAttachment"
  FOR EACH ROW EXECUTE FUNCTION sync_legacy_material();
DO $$ DECLARE item RECORD; BEGIN
  FOR item IN SELECT id FROM "MaterialAttachment" ORDER BY "createdAt", id LOOP
    UPDATE "MaterialAttachment" SET title = title WHERE id = item.id;
  END LOOP;
END $$;

CREATE FUNCTION sync_legacy_lesson_materials() RETURNS trigger AS $$
DECLARE mapped RECORD;
BEGIN
  IF NEW."studentId" IS NULL OR NEW."teacherId" IS NULL THEN RETURN NEW; END IF;
  SELECT m."courseId", m."enrollmentId" INTO mapped
    FROM "LegacyCourseMapping" m JOIN "StudentProfile" student ON student.id = m."studentProfileId"
    WHERE m."studentProfileId" = NEW."studentId" AND student."teacherId" = NEW."teacherId";
  IF mapped."courseId" IS NULL THEN RETURN NEW; END IF;
  INSERT INTO "MaterialPublication" (id, "materialId", "courseId", "publishedAt")
  SELECT 'legacy-material-publication-' || attachment.id || '-' || mapped."courseId",
    material.id, mapped."courseId", attachment."createdAt"
  FROM "MaterialAttachment" attachment JOIN "MaterialTopic" topic ON topic.id = attachment."topicId"
    JOIN "LearningMaterial" material ON material."legacyAttachmentId" = attachment.id
  WHERE topic."teacherId" = NEW."teacherId" AND topic."taskNumber" = ANY(NEW."focusTaskNumbers")
    AND material."archivedAt" IS NULL
  ON CONFLICT (id) DO UPDATE SET "revokedAt" = NULL, revision = "MaterialPublication".revision + 1
    WHERE "MaterialPublication"."revokedAt" IS NOT NULL;
  INSERT INTO "MaterialPublicationRecipient" ("publicationId", "courseId", "enrollmentId")
  SELECT publication.id, mapped."courseId", mapped."enrollmentId" FROM "MaterialPublication" publication
    JOIN "LearningMaterial" material ON material.id = publication."materialId"
    JOIN "MaterialAttachment" attachment ON attachment.id = material."legacyAttachmentId"
    JOIN "MaterialTopic" topic ON topic.id = attachment."topicId"
  WHERE publication."courseId" = mapped."courseId" AND publication."revokedAt" IS NULL
    AND topic."teacherId" = NEW."teacherId" AND topic."taskNumber" = ANY(NEW."focusTaskNumbers")
  ON CONFLICT DO NOTHING;
  PERFORM prune_legacy_material_visibility(NEW."teacherId", NEW."studentId");
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "Lesson_legacy_material_sync" AFTER INSERT OR UPDATE OF "focusTaskNumbers" ON "Lesson"
  FOR EACH ROW EXECUTE FUNCTION sync_legacy_lesson_materials();
