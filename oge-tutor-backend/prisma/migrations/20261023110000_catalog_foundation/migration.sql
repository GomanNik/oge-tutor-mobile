CREATE TYPE "ExamType" AS ENUM ('oge', 'ege');
CREATE TYPE "CatalogStatus" AS ENUM ('active', 'archived');
CREATE TYPE "ProgramVersionStatus" AS ENUM ('draft', 'published', 'archived');
CREATE TYPE "TaskKind" AS ENUM ('short_answer', 'extended_answer', 'choice');
CREATE TYPE "ScoringRuleKind" AS ENUM ('historical_heuristic', 'verified_reference');

CREATE TABLE "CatalogGrant" (
  "userId" TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Subject" (
  "id" TEXT PRIMARY KEY,
  "scopeKey" TEXT NOT NULL,
  "workspaceId" TEXT REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "CatalogStatus" NOT NULL DEFAULT 'active',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Subject_scope_check" CHECK ("scopeKey" = CASE WHEN "workspaceId" IS NULL THEN 'global' ELSE 'w:' || "workspaceId" END)
);
CREATE UNIQUE INDEX "Subject_scopeKey_code_key" ON "Subject"("scopeKey", "code");
CREATE INDEX "Subject_workspaceId_status_name_id_idx" ON "Subject"("workspaceId", "status", "name", "id");

CREATE TABLE "ExamProgram" (
  "id" TEXT PRIMARY KEY,
  "scopeKey" TEXT NOT NULL,
  "workspaceId" TEXT REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "subjectId" TEXT NOT NULL REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "code" TEXT NOT NULL,
  "examType" "ExamType" NOT NULL,
  "variant" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "CatalogStatus" NOT NULL DEFAULT 'active',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExamProgram_scope_check" CHECK ("scopeKey" = CASE WHEN "workspaceId" IS NULL THEN 'global' ELSE 'w:' || "workspaceId" END)
);
CREATE UNIQUE INDEX "ExamProgram_scopeKey_code_key" ON "ExamProgram"("scopeKey", "code");
CREATE UNIQUE INDEX "ExamProgram_scopeKey_examType_subjectId_variant_key" ON "ExamProgram"("scopeKey", "examType", "subjectId", "variant");
CREATE INDEX "ExamProgram_workspaceId_status_name_id_idx" ON "ExamProgram"("workspaceId", "status", "name", "id");
CREATE INDEX "ExamProgram_subjectId_examType_idx" ON "ExamProgram"("subjectId", "examType");

CREATE TABLE "ProgramVersion" (
  "id" TEXT PRIMARY KEY,
  "programId" TEXT NOT NULL REFERENCES "ExamProgram"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "period" TEXT NOT NULL,
  "revisionNumber" INTEGER NOT NULL,
  "status" "ProgramVersionStatus" NOT NULL DEFAULT 'draft',
  "sourceUrl" TEXT,
  "notes" TEXT NOT NULL DEFAULT '',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "ProgramVersion_programId_period_revisionNumber_key" ON "ProgramVersion"("programId", "period", "revisionNumber");
CREATE INDEX "ProgramVersion_programId_status_period_id_idx" ON "ProgramVersion"("programId", "status", "period", "id");

CREATE TABLE "TaskDefinition" (
  "id" TEXT PRIMARY KEY,
  "programVersionId" TEXT NOT NULL REFERENCES "ProgramVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "code" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "topics" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "position" INTEGER NOT NULL,
  "kind" "TaskKind" NOT NULL,
  "maxScore" INTEGER,
  "criteria" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaskDefinition_position_check" CHECK ("position" > 0),
  CONSTRAINT "TaskDefinition_max_score_check" CHECK ("maxScore" IS NULL OR "maxScore" > 0)
);
CREATE UNIQUE INDEX "TaskDefinition_programVersionId_code_key" ON "TaskDefinition"("programVersionId", "code");
CREATE UNIQUE INDEX "TaskDefinition_programVersionId_position_key" ON "TaskDefinition"("programVersionId", "position");
CREATE INDEX "TaskDefinition_programVersionId_position_id_idx" ON "TaskDefinition"("programVersionId", "position", "id");

CREATE TABLE "ScoringRule" (
  "id" TEXT PRIMARY KEY,
  "programVersionId" TEXT NOT NULL REFERENCES "ProgramVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "kind" "ScoringRuleKind" NOT NULL,
  "code" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "sourceUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ScoringRule_programVersionId_key" ON "ScoringRule"("programVersionId");

CREATE TABLE "TaskMapping" (
  "id" TEXT PRIMARY KEY,
  "fromTaskId" TEXT NOT NULL REFERENCES "TaskDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "toTaskId" TEXT NOT NULL REFERENCES "TaskDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "reason" TEXT NOT NULL,
  "createdById" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "revokedAt" TIMESTAMP(3),
  "revokedById" TEXT REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "revocationReason" TEXT,
  CONSTRAINT "TaskMapping_distinct_check" CHECK ("fromTaskId" <> "toTaskId")
);
CREATE INDEX "TaskMapping_fromTaskId_toTaskId_idx" ON "TaskMapping"("fromTaskId", "toTaskId");
CREATE UNIQUE INDEX "TaskMapping_active_pair_key" ON "TaskMapping"("fromTaskId", "toTaskId") WHERE "revokedAt" IS NULL;
CREATE INDEX "TaskMapping_toTaskId_idx" ON "TaskMapping"("toTaskId");

CREATE TABLE "CatalogAuditEvent" (
  "id" TEXT PRIMARY KEY,
  "workspaceId" TEXT REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "actorUserId" TEXT REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "actorKind" TEXT NOT NULL DEFAULT 'user',
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "changes" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "requestId" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "CatalogAuditEvent_workspaceId_occurredAt_id_idx" ON "CatalogAuditEvent"("workspaceId", "occurredAt", "id");
CREATE INDEX "CatalogAuditEvent_targetType_targetId_occurredAt_idx" ON "CatalogAuditEvent"("targetType", "targetId", "occurredAt");

INSERT INTO "Subject" ("id", "scopeKey", "code", "name", "updatedAt")
VALUES ('legacy-subject-math', 'global', 'math', 'Математика', CURRENT_TIMESTAMP);
INSERT INTO "ExamProgram" ("id", "scopeKey", "subjectId", "code", "examType", "variant", "name", "updatedAt")
VALUES ('legacy-program-oge-math', 'global', 'legacy-subject-math', 'oge-math', 'oge', 'general', 'ОГЭ · математика', CURRENT_TIMESTAMP);
INSERT INTO "ProgramVersion" ("id", "programId", "period", "revisionNumber", "status", "notes", "publishedAt", "updatedAt")
VALUES ('legacy-version-oge-math', 'legacy-program-oge-math', 'legacy-import', 1, 'published', 'Исторический каталог прежнего кабинета; баллы и критерии не подтверждены.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "ScoringRule" ("id", "programVersionId", "kind", "code", "description")
VALUES ('legacy-scoring-oge-math', 'legacy-version-oge-math', 'historical_heuristic', 'legacy-progress-v1', 'Историческая эвристика кабинета; неофициальное правило.');
INSERT INTO "TaskDefinition" ("id", "programVersionId", "code", "title", "position", "kind", "updatedAt")
SELECT 'legacy-task-' || LPAD(n::text, 2, '0'), 'legacy-version-oge-math', n::text, title, n, 'short_answer', CURRENT_TIMESTAMP
FROM (VALUES
  (1, 'Вычисления'), (2, 'Дроби и степени'), (3, 'Выражения'), (4, 'Графики и функции'),
  (5, 'Уравнения'), (6, 'Неравенства'), (7, 'Функции'), (8, 'Последовательности'),
  (9, 'Статистика'), (10, 'Вероятность'), (11, 'Текстовые задачи'), (12, 'Проценты'),
  (13, 'Практические задачи'), (14, 'Геометрия'), (15, 'Треугольники'), (16, 'Окружность'),
  (17, 'Геометрия'), (18, 'Площади'), (19, 'Утверждения'), (20, 'Алгебра'),
  (21, 'Текстовая задача'), (22, 'График'), (23, 'Геометрическая задача'),
  (24, 'Доказательство'), (25, 'Сложная геометрия')
) AS legacy(n, title);

CREATE FUNCTION catalog_program_subject_scope() RETURNS trigger AS $$
DECLARE subject_scope TEXT;
BEGIN
  SELECT "scopeKey" INTO subject_scope FROM "Subject" WHERE id = NEW."subjectId";
  IF subject_scope IS NULL OR (subject_scope <> 'global' AND subject_scope <> NEW."scopeKey") THEN
    RAISE EXCEPTION 'Subject is outside program scope';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ExamProgram_subject_scope" BEFORE INSERT OR UPDATE OF "scopeKey", "subjectId" ON "ExamProgram"
FOR EACH ROW EXECUTE FUNCTION catalog_program_subject_scope();

CREATE FUNCTION catalog_task_draft_only() RETURNS trigger AS $$
DECLARE version_status "ProgramVersionStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT status INTO version_status FROM "ProgramVersion" WHERE id = OLD."programVersionId" FOR UPDATE;
  ELSIF TG_OP = 'UPDATE' THEN
    SELECT status INTO version_status FROM "ProgramVersion" WHERE id = OLD."programVersionId" FOR UPDATE;
    IF version_status <> 'draft' THEN RAISE EXCEPTION 'Published catalog tasks are immutable'; END IF;
    SELECT status INTO version_status FROM "ProgramVersion" WHERE id = NEW."programVersionId" FOR UPDATE;
  ELSE
    SELECT status INTO version_status FROM "ProgramVersion" WHERE id = NEW."programVersionId" FOR UPDATE;
  END IF;
  IF version_status <> 'draft' THEN RAISE EXCEPTION 'Published catalog tasks are immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "TaskDefinition_draft_only" BEFORE INSERT OR UPDATE OR DELETE ON "TaskDefinition"
FOR EACH ROW EXECUTE FUNCTION catalog_task_draft_only();
CREATE TRIGGER "ScoringRule_draft_only" BEFORE INSERT OR UPDATE OR DELETE ON "ScoringRule"
FOR EACH ROW EXECUTE FUNCTION catalog_task_draft_only();

CREATE FUNCTION catalog_version_transition() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'archived' THEN RAISE EXCEPTION 'Archived program version is immutable'; END IF;
  IF OLD.status = 'published' AND (
    NEW.status <> 'archived' OR NEW."programId" <> OLD."programId" OR NEW.period <> OLD.period
    OR NEW."revisionNumber" <> OLD."revisionNumber" OR NEW."sourceUrl" IS DISTINCT FROM OLD."sourceUrl"
    OR NEW.notes <> OLD.notes OR NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt"
  ) THEN RAISE EXCEPTION 'Published program version is immutable'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ProgramVersion_transition" BEFORE UPDATE ON "ProgramVersion"
FOR EACH ROW EXECUTE FUNCTION catalog_version_transition();
CREATE FUNCTION catalog_version_delete() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'Published program version cannot be deleted'; END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ProgramVersion_delete" BEFORE DELETE ON "ProgramVersion"
FOR EACH ROW EXECUTE FUNCTION catalog_version_delete();

CREATE FUNCTION catalog_mapping_guard() RETURNS trigger AS $$
DECLARE from_program TEXT;
DECLARE to_program TEXT;
DECLARE from_version TEXT;
DECLARE to_version TEXT;
DECLARE from_status "ProgramVersionStatus";
DECLARE to_status "ProgramVersionStatus";
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."fromTaskId" <> OLD."fromTaskId" OR NEW."toTaskId" <> OLD."toTaskId") THEN
    RAISE EXCEPTION 'Task mapping endpoints are immutable';
  END IF;
  SELECT v."programId", v.id, v.status INTO from_program, from_version, from_status
    FROM "TaskDefinition" t JOIN "ProgramVersion" v ON v.id = t."programVersionId" WHERE t.id = NEW."fromTaskId";
  SELECT v."programId", v.id, v.status INTO to_program, to_version, to_status
    FROM "TaskDefinition" t JOIN "ProgramVersion" v ON v.id = t."programVersionId" WHERE t.id = NEW."toTaskId";
  IF from_program IS NULL OR to_program IS NULL OR from_program <> to_program OR from_version = to_version
     OR from_status = 'draft' OR to_status = 'draft' THEN
    RAISE EXCEPTION 'Task mapping requires published versions of one program';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "TaskMapping_guard" BEFORE INSERT OR UPDATE OF "fromTaskId", "toTaskId" ON "TaskMapping"
FOR EACH ROW EXECUTE FUNCTION catalog_mapping_guard();
