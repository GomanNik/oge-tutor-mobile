CREATE TYPE "CourseFormat" AS ENUM ('individual', 'group');
CREATE TYPE "CourseStatus" AS ENUM ('draft', 'active', 'paused', 'completed', 'archived');
CREATE TYPE "CourseTeacherRole" AS ENUM ('lead', 'assistant', 'substitute');
CREATE TYPE "CourseTeacherStatus" AS ENUM ('active', 'ended');
CREATE TYPE "EnrollmentStatus" AS ENUM ('invited', 'active', 'paused', 'completed', 'withdrawn');

ALTER TABLE "WorkspaceMembership" ADD CONSTRAINT "WorkspaceMembership_id_workspaceId_key" UNIQUE ("id", "workspaceId");

CREATE TABLE "Course" (
  "id" TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "programVersionId" TEXT NOT NULL REFERENCES "ProgramVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "title" TEXT NOT NULL,
  "defaultFormat" "CourseFormat" NOT NULL,
  "capacity" INTEGER NOT NULL,
  "startsOn" DATE NOT NULL,
  "endsOn" DATE,
  "timezone" TEXT NOT NULL,
  "status" "CourseStatus" NOT NULL DEFAULT 'draft',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Course_id_workspaceId_key" UNIQUE ("id", "workspaceId"),
  CONSTRAINT "Course_capacity_check" CHECK ("capacity" BETWEEN 1 AND 100),
  CONSTRAINT "Course_individual_capacity_check" CHECK ("defaultFormat" <> 'individual' OR "capacity" = 1),
  CONSTRAINT "Course_dates_check" CHECK ("endsOn" IS NULL OR "endsOn" >= "startsOn")
);
CREATE INDEX "Course_workspaceId_status_createdAt_id_idx" ON "Course"("workspaceId", "status", "createdAt", "id");
CREATE INDEX "Course_workspaceId_programVersionId_status_idx" ON "Course"("workspaceId", "programVersionId", "status");

CREATE TABLE "CourseTeacher" (
  "id" TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "role" "CourseTeacherRole" NOT NULL,
  "status" "CourseTeacherStatus" NOT NULL DEFAULT 'active',
  "startsOn" DATE NOT NULL,
  "endsOn" DATE,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CourseTeacher_courseId_workspaceId_fkey" FOREIGN KEY ("courseId", "workspaceId") REFERENCES "Course"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CourseTeacher_membershipId_workspaceId_fkey" FOREIGN KEY ("membershipId", "workspaceId") REFERENCES "WorkspaceMembership"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CourseTeacher_dates_check" CHECK ("endsOn" IS NULL OR "endsOn" >= "startsOn")
);
CREATE INDEX "CourseTeacher_courseId_status_role_idx" ON "CourseTeacher"("courseId", "status", "role");
CREATE INDEX "CourseTeacher_membershipId_status_idx" ON "CourseTeacher"("membershipId", "status");
CREATE UNIQUE INDEX "CourseTeacher_one_active_membership_key" ON "CourseTeacher"("courseId", "membershipId") WHERE "status" = 'active';

CREATE TABLE "Enrollment" (
  "id" TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "status" "EnrollmentStatus" NOT NULL DEFAULT 'invited',
  "startsOn" DATE,
  "endsOn" DATE,
  "goal" TEXT NOT NULL DEFAULT '',
  "note" TEXT NOT NULL DEFAULT '',
  "createdByUserId" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Enrollment_courseId_workspaceId_fkey" FOREIGN KEY ("courseId", "workspaceId") REFERENCES "Course"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Enrollment_membershipId_workspaceId_fkey" FOREIGN KEY ("membershipId", "workspaceId") REFERENCES "WorkspaceMembership"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Enrollment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Enrollment_dates_check" CHECK ("startsOn" IS NULL OR "endsOn" IS NULL OR "endsOn" >= "startsOn")
);
CREATE INDEX "Enrollment_courseId_status_createdAt_id_idx" ON "Enrollment"("courseId", "status", "createdAt", "id");
CREATE INDEX "Enrollment_membershipId_status_idx" ON "Enrollment"("membershipId", "status");
CREATE UNIQUE INDEX "Enrollment_one_current_membership_key" ON "Enrollment"("courseId", "membershipId") WHERE "status" IN ('invited', 'active', 'paused');

CREATE TABLE "LegacyCourseMapping" (
  "studentProfileId" TEXT PRIMARY KEY REFERENCES "StudentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "courseId" TEXT NOT NULL UNIQUE REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "enrollmentId" TEXT NOT NULL UNIQUE REFERENCES "Enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE FUNCTION course_version_guard() RETURNS trigger AS $$
DECLARE version_status "ProgramVersionStatus"; program_scope TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."programVersionId" <> OLD."programVersionId" OR NEW."workspaceId" <> OLD."workspaceId") THEN
    RAISE EXCEPTION 'Course program and workspace are immutable';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT v.status, p."scopeKey" INTO version_status, program_scope
    FROM "ProgramVersion" v JOIN "ExamProgram" p ON p.id = v."programId"
    WHERE v.id = NEW."programVersionId";
    IF version_status <> 'published' OR program_scope NOT IN ('global', 'w:' || NEW."workspaceId") THEN
      RAISE EXCEPTION 'Course requires a published program version in scope';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "Course_version_guard" BEFORE INSERT OR UPDATE ON "Course" FOR EACH ROW EXECUTE FUNCTION course_version_guard();

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM "StudentProfile" s
    LEFT JOIN "LegacyWorkspaceMapping" lm ON lm."teacherProfileId" = s."teacherId"
    LEFT JOIN "TeacherProfile" t ON t.id = s."teacherId"
    LEFT JOIN "WorkspaceMembership" tm ON tm."workspaceId" = lm."workspaceId" AND tm."userId" = t."userId"
    LEFT JOIN "WorkspaceMembership" sm ON sm."workspaceId" = lm."workspaceId" AND sm."userId" = s."userId"
    WHERE lm."workspaceId" IS NULL OR tm.id IS NULL OR sm.id IS NULL
      OR NOT EXISTS (SELECT 1 FROM "WorkspaceRoleGrant" tr WHERE tr."membershipId" = tm.id AND tr.role = 'teacher' AND tr."revokedAt" IS NULL)
      OR NOT EXISTS (SELECT 1 FROM "WorkspaceRoleGrant" sr WHERE sr."membershipId" = sm.id AND sr.role = 'student' AND sr."revokedAt" IS NULL)
  ) THEN
    RAISE EXCEPTION 'Legacy student has no unambiguous teacher workspace, membership or role';
  END IF;
END $$;

INSERT INTO "Course" ("id", "workspaceId", "programVersionId", "title", "defaultFormat", "capacity", "startsOn", "timezone", "status", "createdAt", "updatedAt")
SELECT 'legacy-course-' || s.id, lm."workspaceId", 'legacy-version-oge-math', 'ОГЭ математика · ' || s.name,
  'individual', 1, s."createdAt"::date, w.timezone, CASE WHEN s.access = 'active' THEN 'active'::"CourseStatus" ELSE 'draft'::"CourseStatus" END,
  s."createdAt", CURRENT_TIMESTAMP
FROM "StudentProfile" s JOIN "LegacyWorkspaceMapping" lm ON lm."teacherProfileId" = s."teacherId" JOIN "Workspace" w ON w.id = lm."workspaceId";

INSERT INTO "CourseTeacher" ("id", "workspaceId", "courseId", "membershipId", "role", "startsOn", "createdAt", "updatedAt")
SELECT 'legacy-course-teacher-' || s.id, lm."workspaceId", 'legacy-course-' || s.id, tm.id, 'lead', s."createdAt"::date, s."createdAt", CURRENT_TIMESTAMP
FROM "StudentProfile" s JOIN "TeacherProfile" t ON t.id = s."teacherId"
JOIN "LegacyWorkspaceMapping" lm ON lm."teacherProfileId" = t.id
JOIN "WorkspaceMembership" tm ON tm."workspaceId" = lm."workspaceId" AND tm."userId" = t."userId";

INSERT INTO "Enrollment" ("id", "workspaceId", "courseId", "membershipId", "status", "startsOn", "goal", "note", "createdAt", "updatedAt")
SELECT 'legacy-enrollment-' || s.id, lm."workspaceId", 'legacy-course-' || s.id, sm.id,
  CASE WHEN s.access = 'active' THEN 'active'::"EnrollmentStatus" ELSE 'invited'::"EnrollmentStatus" END,
  CASE WHEN s.access = 'active' THEN s."createdAt"::date ELSE NULL END, s.goal, s.note, s."createdAt", CURRENT_TIMESTAMP
FROM "StudentProfile" s JOIN "LegacyWorkspaceMapping" lm ON lm."teacherProfileId" = s."teacherId"
JOIN "WorkspaceMembership" sm ON sm."workspaceId" = lm."workspaceId" AND sm."userId" = s."userId";

INSERT INTO "LegacyCourseMapping" ("studentProfileId", "courseId", "enrollmentId")
SELECT s.id, 'legacy-course-' || s.id, 'legacy-enrollment-' || s.id FROM "StudentProfile" s;
