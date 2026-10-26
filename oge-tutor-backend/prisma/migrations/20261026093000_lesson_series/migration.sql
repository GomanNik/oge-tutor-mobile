CREATE TYPE "LessonSeriesStatus" AS ENUM ('active', 'paused', 'canceled', 'completed');
CREATE TYPE "LessonSeriesFrequency" AS ENUM ('daily', 'weekly', 'monthly');
CREATE TABLE "LessonSeries" (
  id TEXT NOT NULL PRIMARY KEY, "courseId" TEXT NOT NULL, topic TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
  format "CourseFormat" NOT NULL, "startsAtLocal" TEXT NOT NULL, "untilLocalDate" TEXT NOT NULL, timezone TEXT NOT NULL,
  frequency "LessonSeriesFrequency" NOT NULL, interval INTEGER NOT NULL DEFAULT 1, weekdays INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "monthDays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[], "excludedDates" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], "durationMinutes" INTEGER NOT NULL, "materializeDays" INTEGER NOT NULL DEFAULT 45,
  "dstDisambiguation" TEXT NOT NULL DEFAULT 'reject', status "LessonSeriesStatus" NOT NULL DEFAULT 'active',
  revision INTEGER NOT NULL DEFAULT 0, generation INTEGER NOT NULL DEFAULT 0, "operatorUserId" TEXT NOT NULL, "operatorRole" "WorkspaceRole" NOT NULL,
  "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, failures INTEGER NOT NULL DEFAULT 0, "lastErrorCode" TEXT NOT NULL DEFAULT '',
  "materializedThrough" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LessonSeries_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LessonSeries_operatorUserId_fkey" FOREIGN KEY ("operatorUserId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LessonSeries_limits" CHECK (interval BETWEEN 1 AND 12 AND "durationMinutes" BETWEEN 15 AND 480 AND "materializeDays" BETWEEN 7 AND 90 AND "dstDisambiguation" IN ('reject','earlier','later') AND revision>=0 AND generation>=0 AND failures>=0 AND "operatorRole"<>'student')
);
CREATE UNIQUE INDEX "LessonSeries_id_courseId_key" ON "LessonSeries"(id,"courseId");
CREATE INDEX "LessonSeries_courseId_status_createdAt_id_idx" ON "LessonSeries"("courseId",status,"createdAt",id);
CREATE INDEX "LessonSeries_status_nextRunAt_idx" ON "LessonSeries"(status,"nextRunAt");
CREATE TABLE "LessonSeriesTeacher" (
  "seriesId" TEXT NOT NULL, "courseId" TEXT NOT NULL, "courseTeacherId" TEXT NOT NULL,
  CONSTRAINT "LessonSeriesTeacher_pkey" PRIMARY KEY ("seriesId","courseTeacherId"),
  CONSTRAINT "LessonSeriesTeacher_seriesId_courseId_fkey" FOREIGN KEY ("seriesId","courseId") REFERENCES "LessonSeries"(id,"courseId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LessonSeriesTeacher_courseTeacherId_courseId_fkey" FOREIGN KEY ("courseTeacherId","courseId") REFERENCES "CourseTeacher"(id,"courseId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "LessonSeriesTeacher_courseTeacherId_idx" ON "LessonSeriesTeacher"("courseTeacherId");
CREATE TABLE "LessonSeriesParticipant" (
  "seriesId" TEXT NOT NULL, "courseId" TEXT NOT NULL, "enrollmentId" TEXT NOT NULL,
  CONSTRAINT "LessonSeriesParticipant_pkey" PRIMARY KEY ("seriesId","enrollmentId"),
  CONSTRAINT "LessonSeriesParticipant_seriesId_courseId_fkey" FOREIGN KEY ("seriesId","courseId") REFERENCES "LessonSeries"(id,"courseId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LessonSeriesParticipant_enrollmentId_courseId_fkey" FOREIGN KEY ("enrollmentId","courseId") REFERENCES "Enrollment"(id,"courseId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "LessonSeriesParticipant_enrollmentId_idx" ON "LessonSeriesParticipant"("enrollmentId");
ALTER TABLE "Lesson" ADD COLUMN "seriesId" TEXT, ADD COLUMN "seriesRevision" INTEGER, ADD COLUMN "seriesOccurrenceKey" TEXT, ADD COLUMN "seriesException" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_seriesId_courseId_fkey" FOREIGN KEY ("seriesId","courseId") REFERENCES "LessonSeries"(id,"courseId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_series_identity" CHECK (("seriesId" IS NULL AND "seriesRevision" IS NULL AND "seriesOccurrenceKey" IS NULL AND NOT "seriesException") OR ("seriesId" IS NOT NULL AND "courseId" IS NOT NULL AND "seriesRevision" IS NOT NULL AND "seriesRevision">=0 AND "seriesOccurrenceKey" IS NOT NULL));
CREATE UNIQUE INDEX "Lesson_seriesId_seriesRevision_seriesOccurrenceKey_key" ON "Lesson"("seriesId","seriesRevision","seriesOccurrenceKey");
CREATE INDEX "Lesson_seriesId_startAt_idx" ON "Lesson"("seriesId","startAt");
