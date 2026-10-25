CREATE TYPE "LearningProgressSource" AS ENUM ('manual','diagnostic','lesson','submission','legacy_unknown');
CREATE TYPE "LearningProgressKind" AS ENUM ('assessment','activity','retraction','snapshot');
CREATE TYPE "LearningVisibility" AS ENUM ('private','published');
CREATE TYPE "LearningDeliveryStatus" AS ENUM ('queued','processing','sent','failed','skipped','dev_preview');

CREATE TABLE "LearningProgressEvent" (
  id TEXT NOT NULL PRIMARY KEY, "enrollmentId" TEXT NOT NULL, "taskDefinitionId" TEXT,
  source "LearningProgressSource" NOT NULL, "sourceKey" TEXT NOT NULL, kind "LearningProgressKind" NOT NULL DEFAULT 'assessment',
  "authorUserId" TEXT, visibility "LearningVisibility" NOT NULL DEFAULT 'private', score INTEGER, "maxScore" INTEGER,
  "coverageStatus" "ProgressCoverageStatus", "masteryLevel" "ProgressMasteryLevel", comment TEXT NOT NULL DEFAULT '',
  basis TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '', evidence JSONB NOT NULL DEFAULT '{}', "legacyPayload" JSONB,
  "supersedesId" TEXT, "occurredAt" TIMESTAMP(3) NOT NULL, "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "LearningProgressProjection" (
  "enrollmentId" TEXT NOT NULL, "taskDefinitionId" TEXT NOT NULL, "eventId" TEXT NOT NULL,
  "algorithmVersion" TEXT NOT NULL DEFAULT 'latest-published-v1', "projectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LearningProgressProjection_pkey" PRIMARY KEY ("enrollmentId","taskDefinitionId")
);
CREATE TABLE "LearningNotification" (
  id TEXT NOT NULL PRIMARY KEY, "workspaceId" TEXT NOT NULL, "recipientUserId" TEXT NOT NULL, "recipientRole" "WorkspaceRole" NOT NULL,
  "eventKey" TEXT NOT NULL, type TEXT NOT NULL, "targetType" TEXT NOT NULL, "targetId" TEXT NOT NULL, title TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '', "readAt" TIMESTAMP(3), revision INTEGER NOT NULL DEFAULT 0, "legacyNotificationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "LearningNotificationPreference" (
  "workspaceId" TEXT NOT NULL, "userId" TEXT NOT NULL, "emailEnabled" BOOLEAN NOT NULL DEFAULT false, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LearningNotificationPreference_pkey" PRIMARY KEY ("workspaceId","userId")
);
CREATE TABLE "LearningDelivery" (
  id TEXT NOT NULL PRIMARY KEY, "notificationId" TEXT NOT NULL, status "LearningDeliveryStatus" NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0, "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lockedUntil" TIMESTAMP(3),
  "lockToken" TEXT, "lastErrorCode" TEXT NOT NULL DEFAULT '', provider TEXT NOT NULL DEFAULT '', "deliveredAt" TIMESTAMP(3),
  revision INTEGER NOT NULL DEFAULT 0, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "LearningProgressEvent_sourceKey_key" ON "LearningProgressEvent"("sourceKey");
CREATE UNIQUE INDEX "LearningProgressEvent_supersedesId_key" ON "LearningProgressEvent"("supersedesId");
CREATE INDEX "LearningProgressEvent_enrollmentId_occurredAt_id_idx" ON "LearningProgressEvent"("enrollmentId","occurredAt",id);
CREATE INDEX "LearningProgressEvent_enrollmentId_recordedAt_id_idx" ON "LearningProgressEvent"("enrollmentId","recordedAt",id);
CREATE INDEX "LearningProgressEvent_enrollmentId_taskDefinitionId_visibil_idx" ON "LearningProgressEvent"("enrollmentId","taskDefinitionId",visibility,"occurredAt",id);
CREATE UNIQUE INDEX "LearningProgressProjection_eventId_key" ON "LearningProgressProjection"("eventId");
CREATE UNIQUE INDEX "LearningNotification_legacyNotificationId_key" ON "LearningNotification"("legacyNotificationId");
CREATE INDEX "LearningNotification_workspaceId_recipientUserId_recipientR_idx" ON "LearningNotification"("workspaceId","recipientUserId","recipientRole","createdAt",id);
CREATE INDEX "LearningNotification_recipient_read_idx" ON "LearningNotification"("workspaceId","recipientUserId","recipientRole","readAt");
CREATE UNIQUE INDEX "LearningNotification_recipientUserId_eventKey_key" ON "LearningNotification"("recipientUserId","eventKey");
CREATE UNIQUE INDEX "LearningDelivery_notificationId_key" ON "LearningDelivery"("notificationId");
CREATE INDEX "LearningDelivery_status_availableAt_lockedUntil_idx" ON "LearningDelivery"(status,"availableAt","lockedUntil");
CREATE INDEX "LearningDelivery_createdAt_id_idx" ON "LearningDelivery"("createdAt",id);
ALTER TABLE "LearningProgressEvent" ADD CONSTRAINT "LearningProgressEvent_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LearningProgressEvent" ADD CONSTRAINT "LearningProgressEvent_taskDefinitionId_fkey" FOREIGN KEY ("taskDefinitionId") REFERENCES "TaskDefinition"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LearningProgressEvent" ADD CONSTRAINT "LearningProgressEvent_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LearningProgressEvent" ADD CONSTRAINT "LearningProgressEvent_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "LearningProgressEvent"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LearningProgressProjection" ADD CONSTRAINT "LearningProgressProjection_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LearningProgressProjection" ADD CONSTRAINT "LearningProgressProjection_taskDefinitionId_fkey" FOREIGN KEY ("taskDefinitionId") REFERENCES "TaskDefinition"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LearningProgressProjection" ADD CONSTRAINT "LearningProgressProjection_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "LearningProgressEvent"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LearningNotification" ADD CONSTRAINT "LearningNotification_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LearningNotification" ADD CONSTRAINT "LearningNotification_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LearningNotificationPreference" ADD CONSTRAINT "LearningNotificationPreference_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LearningNotificationPreference" ADD CONSTRAINT "LearningNotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LearningDelivery" ADD CONSTRAINT "LearningDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "LearningNotification"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION learning_event_guard() RETURNS trigger AS $$
DECLARE parent "LearningProgressEvent"; version_id TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Learning progress history is immutable' USING ERRCODE='23514'; END IF;
  SELECT c."programVersionId" INTO version_id FROM "Enrollment" e JOIN "Course" c ON c.id=e."courseId" WHERE e.id=NEW."enrollmentId";
  IF NEW."taskDefinitionId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "TaskDefinition" WHERE id=NEW."taskDefinitionId" AND "programVersionId"=version_id) THEN
    RAISE EXCEPTION 'Progress task belongs to another program version' USING ERRCODE='23514';
  END IF;
  IF (NEW.score IS NULL) <> (NEW."maxScore" IS NULL) OR NEW.score < 0 OR NEW."maxScore" < 0 OR NEW.score > NEW."maxScore" THEN
    RAISE EXCEPTION 'Invalid progress score' USING ERRCODE='23514';
  END IF;
  IF NEW."supersedesId" IS NOT NULL THEN
    SELECT * INTO STRICT parent FROM "LearningProgressEvent" WHERE id=NEW."supersedesId";
    IF parent."enrollmentId" <> NEW."enrollmentId" OR parent."taskDefinitionId" IS DISTINCT FROM NEW."taskDefinitionId"
      OR (parent.visibility='published' AND NEW.visibility<>'published') THEN RAISE EXCEPTION 'Invalid progress correction' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "LearningProgressEvent_guard" BEFORE INSERT OR UPDATE OR DELETE ON "LearningProgressEvent" FOR EACH ROW EXECUTE FUNCTION learning_event_guard();

CREATE FUNCTION learning_refresh_projection(enrollment_id TEXT, task_id TEXT) RETURNS void AS $$
DECLARE event_id TEXT;
BEGIN
  IF task_id IS NULL THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('progress:'||enrollment_id||':'||task_id,0));
  SELECT e.id INTO event_id FROM "LearningProgressEvent" e
    WHERE e."enrollmentId"=enrollment_id AND e."taskDefinitionId"=task_id AND e.visibility='published' AND e.kind<>'retraction'
      AND NOT EXISTS (SELECT 1 FROM "LearningProgressEvent" child WHERE child."supersedesId"=e.id AND child.visibility='published')
    ORDER BY e."occurredAt" DESC,e."recordedAt" DESC,e.id DESC LIMIT 1;
  IF event_id IS NULL THEN DELETE FROM "LearningProgressProjection" WHERE "enrollmentId"=enrollment_id AND "taskDefinitionId"=task_id;
  ELSE
    INSERT INTO "LearningProgressProjection" ("enrollmentId","taskDefinitionId","eventId") VALUES (enrollment_id,task_id,event_id)
      ON CONFLICT ("enrollmentId","taskDefinitionId") DO UPDATE SET "eventId"=EXCLUDED."eventId","algorithmVersion"='latest-published-v1',"projectedAt"=CURRENT_TIMESTAMP;
  END IF;
END $$ LANGUAGE plpgsql;
CREATE FUNCTION learning_project_insert() RETURNS trigger AS $$ BEGIN
  PERFORM learning_refresh_projection(NEW."enrollmentId",NEW."taskDefinitionId"); RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "LearningProgressEvent_project" AFTER INSERT ON "LearningProgressEvent" FOR EACH ROW EXECUTE FUNCTION learning_project_insert();
CREATE FUNCTION learning_rebuild_progress() RETURNS void AS $$ DECLARE pair RECORD; BEGIN
  FOR pair IN SELECT DISTINCT "enrollmentId","taskDefinitionId" FROM "LearningProgressEvent" WHERE "taskDefinitionId" IS NOT NULL ORDER BY 1,2 LOOP
    PERFORM learning_refresh_projection(pair."enrollmentId",pair."taskDefinitionId");
  END LOOP;
END $$ LANGUAGE plpgsql;

CREATE FUNCTION learning_import_snapshot(progress_id TEXT) RETURNS void AS $$
DECLARE p "StudentTaskProgress"; enrollment_id TEXT; task_id TEXT; event_key TEXT;
BEGIN
  SELECT * INTO STRICT p FROM "StudentTaskProgress" WHERE id=progress_id;
  SELECT "enrollmentId" INTO STRICT enrollment_id FROM "LegacyCourseMapping" WHERE "studentProfileId"=p."studentId";
  SELECT id INTO STRICT task_id FROM "TaskDefinition" WHERE "programVersionId"='legacy-version-oge-math' AND position=p."taskNumber";
  event_key := 'legacy-snapshot:'||p.id||':'||md5(to_jsonb(p)::TEXT);
  INSERT INTO "LearningProgressEvent" (id,"enrollmentId","taskDefinitionId",source,"sourceKey",kind,visibility,"coverageStatus","masteryLevel",basis,"legacyPayload","occurredAt")
    VALUES (event_key,enrollment_id,task_id,'legacy_unknown',event_key,'snapshot','published',p."coverageStatus",p."masteryLevel",'Исторический снимок v1',to_jsonb(p),COALESCE(p."lastActivityAt",p."updatedAt",p."createdAt")) ON CONFLICT ("sourceKey") DO NOTHING;
END $$ LANGUAGE plpgsql;
CREATE FUNCTION learning_import_history(history_id TEXT) RETURNS void AS $$
DECLARE p "ProgressHistory"; enrollment_id TEXT; task_id TEXT;
BEGIN
  SELECT * INTO STRICT p FROM "ProgressHistory" WHERE id=history_id;
  SELECT "enrollmentId" INTO STRICT enrollment_id FROM "LegacyCourseMapping" WHERE "studentProfileId"=p."studentId";
  SELECT id INTO STRICT task_id FROM "TaskDefinition" WHERE "programVersionId"='legacy-version-oge-math' AND position=p."taskNumber";
  INSERT INTO "LearningProgressEvent" (id,"enrollmentId","taskDefinitionId",source,"sourceKey",visibility,"coverageStatus","masteryLevel",basis,evidence,"legacyPayload","occurredAt")
    VALUES ('legacy-history-'||p.id,enrollment_id,task_id,'legacy_unknown','legacy-history:'||p.id,'published',p."coverageStatus",p."masteryLevel",'Историческая запись v1',jsonb_build_object('legacySource',p.source,'lessonId',p."lessonId"),to_jsonb(p),p."createdAt") ON CONFLICT ("sourceKey") DO NOTHING;
END $$ LANGUAGE plpgsql;
CREATE FUNCTION learning_snapshot_trigger() RETURNS trigger AS $$ BEGIN PERFORM learning_import_snapshot(NEW.id); RETURN NEW; END $$ LANGUAGE plpgsql;
CREATE FUNCTION learning_history_trigger() RETURNS trigger AS $$ BEGIN PERFORM learning_import_history(NEW.id); RETURN NEW; END $$ LANGUAGE plpgsql;
CREATE TRIGGER "StudentTaskProgress_learning" AFTER INSERT OR UPDATE ON "StudentTaskProgress" FOR EACH ROW EXECUTE FUNCTION learning_snapshot_trigger();
CREATE TRIGGER "ProgressHistory_learning" AFTER INSERT ON "ProgressHistory" FOR EACH ROW EXECUTE FUNCTION learning_history_trigger();
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT id FROM "StudentTaskProgress" ORDER BY id LOOP PERFORM learning_import_snapshot(r.id); END LOOP;
  FOR r IN SELECT id FROM "ProgressHistory" ORDER BY "createdAt",id LOOP PERFORM learning_import_history(r.id); END LOOP;
END $$;

CREATE FUNCTION learning_record_review(review_id TEXT) RETURNS void AS $$
DECLARE r RECORD; task_id TEXT; task JSONB; points INTEGER; maximum INTEGER; parent_id TEXT; event_key TEXT; general_parent TEXT; event_source "LearningProgressSource";
BEGIN
  SELECT review.*,s.id AS submission_id,recipient.id AS recipient_id,recipient."enrollmentId" AS enrollment_id,assignment.id AS assignment_id,assignment."taskSnapshot" AS tasks
    INTO STRICT r FROM "AssignmentReview" review JOIN "AssignmentSubmission" s ON s.id=review."submissionId"
    JOIN "AssignmentRecipient" recipient ON recipient.id=s."recipientId" JOIN "Assignment" assignment ON assignment.id=recipient."assignmentId"
    WHERE review.id=review_id;
  IF r.status<>'published' THEN RETURN; END IF;
  event_source := CASE WHEN r.source='legacy' THEN 'legacy_unknown'::"LearningProgressSource" ELSE 'submission'::"LearningProgressSource" END;
  FOR task_id IN
    SELECT DISTINCT value->>'taskDefinitionId' FROM jsonb_array_elements(r.scores)
    UNION SELECT e."taskDefinitionId" FROM "LearningProgressEvent" e WHERE e.source=event_source AND e.evidence->>'submissionId'=r.submission_id AND e."taskDefinitionId" IS NOT NULL
    ORDER BY 1
  LOOP
    event_key := 'review:'||r.id||':task:'||task_id;
    IF EXISTS (SELECT 1 FROM "LearningProgressEvent" WHERE "sourceKey"=event_key) THEN CONTINUE; END IF;
    SELECT value INTO task FROM jsonb_array_elements(r.tasks) WHERE value->>'id'=task_id;
    SELECT SUM((value->>'score')::INTEGER) INTO points FROM jsonb_array_elements(r.scores) WHERE value->>'taskDefinitionId'=task_id;
    maximum := COALESCE((task->>'maxScore')::INTEGER,(SELECT SUM((value->>'maxScore')::INTEGER) FROM jsonb_array_elements(COALESCE(task->'criteria','[]'::JSONB))));
    SELECT e.id INTO parent_id FROM "LearningProgressEvent" e WHERE e.source=event_source AND e.evidence->>'submissionId'=r.submission_id
      AND e."taskDefinitionId"=task_id AND NOT EXISTS (SELECT 1 FROM "LearningProgressEvent" child WHERE child."supersedesId"=e.id)
      ORDER BY e."recordedAt" DESC,e.id DESC LIMIT 1;
    INSERT INTO "LearningProgressEvent" (id,"enrollmentId","taskDefinitionId",source,"sourceKey",kind,"authorUserId",visibility,score,"maxScore","coverageStatus",basis,reason,evidence,"supersedesId","occurredAt")
      VALUES ('review-progress-'||r.id||'-'||md5(task_id),r.enrollment_id,task_id,event_source,event_key,
        CASE WHEN points IS NULL THEN 'retraction'::"LearningProgressKind" ELSE 'assessment'::"LearningProgressKind" END,r."reviewerUserId",'published',points,CASE WHEN points IS NULL THEN NULL ELSE maximum END,
        CASE WHEN points IS NULL THEN NULL ELSE 'assessed'::"ProgressCoverageStatus" END,'Опубликованная проверка',r.reason,
        jsonb_build_object('reviewId',r.id,'submissionId',r.submission_id,'assignmentId',r.assignment_id,'recipientId',r.recipient_id),parent_id,COALESCE(r."publishedAt",r."createdAt"));
  END LOOP;
  IF jsonb_array_length(r.scores)=0 THEN
    event_key := 'review:'||r.id||':general';
    SELECT e.id INTO general_parent FROM "LearningProgressEvent" e WHERE e.source=event_source AND e.evidence->>'submissionId'=r.submission_id AND e."taskDefinitionId" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "LearningProgressEvent" child WHERE child."supersedesId"=e.id) ORDER BY e."recordedAt" DESC,e.id DESC LIMIT 1;
    INSERT INTO "LearningProgressEvent" (id,"enrollmentId",source,"sourceKey",kind,"authorUserId",visibility,basis,reason,evidence,"supersedesId","occurredAt")
      VALUES ('review-progress-'||r.id||'-general',r.enrollment_id,event_source,event_key,'activity',r."reviewerUserId",'published','Опубликована проверка без балльной оценки',r.reason,
        jsonb_build_object('reviewId',r.id,'submissionId',r.submission_id,'assignmentId',r.assignment_id,'decision',r.decision),general_parent,COALESCE(r."publishedAt",r."createdAt")) ON CONFLICT ("sourceKey") DO NOTHING;
  END IF;
END $$ LANGUAGE plpgsql;
CREATE FUNCTION learning_review_trigger() RETURNS trigger AS $$ BEGIN IF NEW.status='published' THEN PERFORM learning_record_review(NEW.id); END IF; RETURN NEW; END $$ LANGUAGE plpgsql;
CREATE TRIGGER "AssignmentReview_learning_progress" AFTER INSERT OR UPDATE OF status ON "AssignmentReview" FOR EACH ROW EXECUTE FUNCTION learning_review_trigger();
DO $$ DECLARE r RECORD; BEGIN FOR r IN SELECT id FROM "AssignmentReview" WHERE status='published' ORDER BY "publishedAt",id LOOP PERFORM learning_record_review(r.id); END LOOP; END $$;

CREATE FUNCTION learning_record_lesson(lesson_id TEXT, correction_reason TEXT DEFAULT '') RETURNS void AS $$
DECLARE l "Lesson"; p "LessonParticipant"; parent_id TEXT; event_key TEXT;
BEGIN
  SELECT * INTO STRICT l FROM "Lesson" WHERE id=lesson_id;
  IF l.status<>'completed' OR EXISTS (SELECT 1 FROM "LegacyCourseMapping" WHERE "courseId"=l."courseId") THEN RETURN; END IF;
  FOR p IN SELECT * FROM "LessonParticipant" WHERE "lessonId"=lesson_id ORDER BY "enrollmentId" LOOP
    event_key := 'lesson:'||lesson_id||':'||p."enrollmentId"||':'||COALESCE(p."attendanceMarkedAt",l."completedAt",l."startAt")::TEXT;
    IF EXISTS (SELECT 1 FROM "LearningProgressEvent" WHERE "sourceKey"=event_key) THEN CONTINUE; END IF;
    SELECT e.id INTO parent_id FROM "LearningProgressEvent" e WHERE e.source='lesson' AND e."enrollmentId"=p."enrollmentId" AND e.evidence->>'lessonId'=lesson_id
      AND NOT EXISTS (SELECT 1 FROM "LearningProgressEvent" child WHERE child."supersedesId"=e.id) ORDER BY e."recordedAt" DESC,e.id DESC LIMIT 1;
    INSERT INTO "LearningProgressEvent" (id,"enrollmentId",source,"sourceKey",kind,"authorUserId",visibility,basis,reason,evidence,"supersedesId","occurredAt")
      VALUES ('lesson-progress-'||md5(event_key),p."enrollmentId",'lesson',event_key,'activity',p."attendanceMarkedByUserId",'published','Посещаемость занятия',correction_reason,
        jsonb_build_object('lessonId',lesson_id,'attendance',p.attendance),parent_id,l."startAt");
  END LOOP;
END $$ LANGUAGE plpgsql;
DO $$ DECLARE r RECORD; BEGIN FOR r IN SELECT id FROM "Lesson" WHERE status='completed' ORDER BY "startAt",id LOOP PERFORM learning_record_lesson(r.id); END LOOP; END $$;

CREATE FUNCTION learning_import_notice(notice_id TEXT) RETURNS void AS $$
DECLARE n "Notification"; teacher_user TEXT; workspace_id TEXT; enrollment_id TEXT;
BEGIN
  SELECT * INTO STRICT n FROM "Notification" WHERE id=notice_id;
  SELECT t."userId",m."workspaceId" INTO STRICT teacher_user,workspace_id FROM "TeacherProfile" t JOIN "LegacyWorkspaceMapping" m ON m."teacherProfileId"=t.id WHERE t.id=n."teacherId";
  SELECT "enrollmentId" INTO enrollment_id FROM "LegacyCourseMapping" WHERE "studentProfileId"=n."studentId";
  INSERT INTO "LearningNotification" (id,"workspaceId","recipientUserId","recipientRole","eventKey",type,"targetType","targetId",title,message,"readAt","legacyNotificationId","createdAt")
    VALUES ('legacy-notice-'||n.id,workspace_id,teacher_user,'teacher','legacy-notice:'||n.id,'legacy.progress_assessment_required',
      CASE WHEN enrollment_id IS NOT NULL THEN 'progress' ELSE 'lesson' END,COALESCE(enrollment_id,n."lessonId",''),n.title,n.message,
      CASE WHEN n.status='unread' THEN NULL ELSE COALESCE(n."resolvedAt",n."createdAt") END,n.id,n."createdAt")
    ON CONFLICT ("legacyNotificationId") DO UPDATE SET "readAt"=EXCLUDED."readAt",revision="LearningNotification".revision+1
      WHERE ("LearningNotification"."readAt" IS NULL) IS DISTINCT FROM (EXCLUDED."readAt" IS NULL);
END $$ LANGUAGE plpgsql;
CREATE FUNCTION learning_notice_trigger() RETURNS trigger AS $$ BEGIN PERFORM learning_import_notice(NEW.id); RETURN NEW; END $$ LANGUAGE plpgsql;
CREATE TRIGGER "Notification_learning" AFTER INSERT OR UPDATE OF status ON "Notification" FOR EACH ROW EXECUTE FUNCTION learning_notice_trigger();
DO $$ DECLARE r RECORD; BEGIN FOR r IN SELECT id FROM "Notification" ORDER BY "createdAt",id LOOP PERFORM learning_import_notice(r.id); END LOOP; END $$;
