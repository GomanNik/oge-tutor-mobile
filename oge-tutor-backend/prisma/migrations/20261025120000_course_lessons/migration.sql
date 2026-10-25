CREATE TYPE "LessonAttendance" AS ENUM ('unknown', 'present', 'absent', 'excused');
CREATE TYPE "LessonResponseStatus" AS ENUM ('invited', 'accepted', 'declined');

ALTER TABLE "CourseTeacher" ADD CONSTRAINT "CourseTeacher_id_courseId_key" UNIQUE ("id", "courseId");
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_id_courseId_key" UNIQUE ("id", "courseId");

ALTER TABLE "Lesson" ADD COLUMN "courseId" TEXT;
ALTER TABLE "Lesson" ADD COLUMN "format" "CourseFormat" NOT NULL DEFAULT 'individual';
ALTER TABLE "Lesson" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM "Lesson" l
    LEFT JOIN "LegacyCourseMapping" m ON m."studentProfileId" = l."studentId"
    LEFT JOIN "StudentProfile" s ON s.id = l."studentId"
    WHERE m."courseId" IS NULL OR s."teacherId" <> l."teacherId"
  ) THEN
    RAISE EXCEPTION 'Legacy lesson has no matching course or teacher; repair before migration';
  END IF;
END $$;

UPDATE "Lesson" l SET "courseId" = m."courseId"
FROM "LegacyCourseMapping" m WHERE m."studentProfileId" = l."studentId";
ALTER TABLE "Lesson" ALTER COLUMN "courseId" SET NOT NULL;
ALTER TABLE "Lesson" ALTER COLUMN "teacherId" DROP NOT NULL;
ALTER TABLE "Lesson" ALTER COLUMN "studentId" DROP NOT NULL;
ALTER TABLE "Lesson" DROP CONSTRAINT "Lesson_teacherId_fkey";
ALTER TABLE "Lesson" DROP CONSTRAINT "Lesson_studentId_fkey";
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "TeacherProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_legacy_pair_check" CHECK (("teacherId" IS NULL) = ("studentId" IS NULL));
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_id_courseId_key" UNIQUE ("id", "courseId");
CREATE INDEX "Lesson_courseId_status_startAt_id_idx" ON "Lesson"("courseId", "status", "startAt", "id");

CREATE TABLE "LessonTeacher" (
  "id" TEXT PRIMARY KEY,
  "lessonId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "courseTeacherId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LessonTeacher_lessonId_courseId_fkey" FOREIGN KEY ("lessonId", "courseId") REFERENCES "Lesson"("id", "courseId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LessonTeacher_courseTeacherId_courseId_fkey" FOREIGN KEY ("courseTeacherId", "courseId") REFERENCES "CourseTeacher"("id", "courseId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LessonTeacher_lessonId_courseTeacherId_key" UNIQUE ("lessonId", "courseTeacherId")
);
CREATE INDEX "LessonTeacher_courseTeacherId_idx" ON "LessonTeacher"("courseTeacherId");

CREATE TABLE "LessonParticipant" (
  "id" TEXT PRIMARY KEY,
  "lessonId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "enrollmentId" TEXT NOT NULL,
  "responseStatus" "LessonResponseStatus" NOT NULL DEFAULT 'invited',
  "attendance" "LessonAttendance" NOT NULL DEFAULT 'unknown',
  "attendanceMarkedAt" TIMESTAMP(3),
  "attendanceMarkedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LessonParticipant_lessonId_courseId_fkey" FOREIGN KEY ("lessonId", "courseId") REFERENCES "Lesson"("id", "courseId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LessonParticipant_enrollmentId_courseId_fkey" FOREIGN KEY ("enrollmentId", "courseId") REFERENCES "Enrollment"("id", "courseId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LessonParticipant_attendanceMarkedByUserId_fkey" FOREIGN KEY ("attendanceMarkedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LessonParticipant_lessonId_enrollmentId_key" UNIQUE ("lessonId", "enrollmentId")
);
CREATE INDEX "LessonParticipant_enrollmentId_idx" ON "LessonParticipant"("enrollmentId");

INSERT INTO "LessonTeacher" ("id", "lessonId", "courseId", "courseTeacherId")
SELECT 'legacy-lesson-teacher-' || l.id, l.id, l."courseId", 'legacy-course-teacher-' || l."studentId"
FROM "Lesson" l;

INSERT INTO "LessonParticipant" ("id", "lessonId", "courseId", "enrollmentId", "responseStatus")
SELECT 'legacy-lesson-participant-' || l.id, l.id, l."courseId", m."enrollmentId", 'accepted'
FROM "Lesson" l JOIN "LegacyCourseMapping" m ON m."studentProfileId" = l."studentId";
