CREATE TABLE "LegacyCutover" (id TEXT NOT NULL PRIMARY KEY, "cutoverAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);

CREATE OR REPLACE FUNCTION learning_record_lesson(lesson_id TEXT, correction_reason TEXT DEFAULT '') RETURNS void AS $$
DECLARE l "Lesson"; p "LessonParticipant"; parent_id TEXT; event_key TEXT;
BEGIN
  SELECT * INTO STRICT l FROM "Lesson" WHERE id=lesson_id;
  IF l.status<>'completed' THEN RETURN; END IF;
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
