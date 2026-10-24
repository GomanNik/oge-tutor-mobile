-- Expand first; existing accounts are named before the new constraint is enforced.
-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('admin', 'teacher', 'student');

-- CreateEnum
CREATE TYPE "WorkspaceStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('pending', 'accepted', 'revoked', 'expired');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('queued', 'sent', 'failed');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "role" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "status" "WorkspaceStatus" NOT NULL DEFAULT 'active',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMembership" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'active',
    "displayNameOverride" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "suspendedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceRoleGrant" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,

    CONSTRAINT "WorkspaceRoleGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceInvitation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'pending',
    "deliveryStatus" "DeliveryStatus" NOT NULL DEFAULT 'queued',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "inviterUserId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceInvitationRole" (
    "invitationId" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL,

    CONSTRAINT "WorkspaceInvitationRole_pkey" PRIMARY KEY ("invitationId","role")
);

-- CreateTable
CREATE TABLE "WorkspaceEmailOutbox" (
    "id" TEXT NOT NULL,
    "invitationId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "encryptedLink" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceEmailOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceAuditEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorKind" TEXT NOT NULL DEFAULT 'user',
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "changes" JSONB NOT NULL DEFAULT '{}',
    "reason" TEXT,
    "requestId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegacyWorkspaceMapping" (
    "teacherProfileId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,

    CONSTRAINT "LegacyWorkspaceMapping_pkey" PRIMARY KEY ("teacherProfileId")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE INDEX "WorkspaceMembership_workspaceId_status_id_idx" ON "WorkspaceMembership"("workspaceId", "status", "id");

-- CreateIndex
CREATE INDEX "WorkspaceMembership_userId_status_idx" ON "WorkspaceMembership"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMembership_workspaceId_userId_key" ON "WorkspaceMembership"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceRoleGrant_membershipId_role_key" ON "WorkspaceRoleGrant"("membershipId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceInvitation_tokenHash_key" ON "WorkspaceInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "WorkspaceInvitation_workspaceId_email_status_idx" ON "WorkspaceInvitation"("workspaceId", "email", "status");

-- CreateIndex
CREATE INDEX "WorkspaceInvitation_workspaceId_createdAt_id_idx" ON "WorkspaceInvitation"("workspaceId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "WorkspaceEmailOutbox_sentAt_canceledAt_nextAttemptAt_idx" ON "WorkspaceEmailOutbox"("sentAt", "canceledAt", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "WorkspaceAuditEvent_workspaceId_occurredAt_id_idx" ON "WorkspaceAuditEvent"("workspaceId", "occurredAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LegacyWorkspaceMapping_workspaceId_key" ON "LegacyWorkspaceMapping"("workspaceId");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_actorUserId_route_key_key" ON "IdempotencyRecord"("actorUserId", "route", "key");

-- AddForeignKey
ALTER TABLE "WorkspaceMembership" ADD CONSTRAINT "WorkspaceMembership_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMembership" ADD CONSTRAINT "WorkspaceMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceRoleGrant" ADD CONSTRAINT "WorkspaceRoleGrant_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "WorkspaceMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceRoleGrant" ADD CONSTRAINT "WorkspaceRoleGrant_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceRoleGrant" ADD CONSTRAINT "WorkspaceRoleGrant_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceInvitation" ADD CONSTRAINT "WorkspaceInvitation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceInvitation" ADD CONSTRAINT "WorkspaceInvitation_inviterUserId_fkey" FOREIGN KEY ("inviterUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceInvitationRole" ADD CONSTRAINT "WorkspaceInvitationRole_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "WorkspaceInvitation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceEmailOutbox" ADD CONSTRAINT "WorkspaceEmailOutbox_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "WorkspaceInvitation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceAuditEvent" ADD CONSTRAINT "WorkspaceAuditEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceAuditEvent" ADD CONSTRAINT "WorkspaceAuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegacyWorkspaceMapping" ADD CONSTRAINT "LegacyWorkspaceMapping_teacherProfileId_fkey" FOREIGN KEY ("teacherProfileId") REFERENCES "TeacherProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegacyWorkspaceMapping" ADD CONSTRAINT "LegacyWorkspaceMapping_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "WorkspaceInvitation_pending_workspace_email_key"
  ON "WorkspaceInvitation"("workspaceId", "email") WHERE "status" = 'pending';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "User" u
    LEFT JOIN "TeacherProfile" t ON t."userId" = u.id
    LEFT JOIN "StudentProfile" s ON s."userId" = u.id
    WHERE (u.role = 'teacher' AND (t.id IS NULL OR BTRIM(t.name) = ''))
       OR (u.role = 'student' AND (s.id IS NULL OR BTRIM(s.name) = ''))
       OR u.role IS NULL
  ) THEN
    RAISE EXCEPTION 'Legacy account without a valid role/profile/name; inspect before migration';
  END IF;
END $$;

UPDATE "User" u SET "displayName" = CASE
  WHEN u.role = 'teacher' THEN t.name
  ELSE s.name
END
FROM "User" source
LEFT JOIN "TeacherProfile" t ON t."userId" = source.id
LEFT JOIN "StudentProfile" s ON s."userId" = source.id
WHERE u.id = source.id;
ALTER TABLE "User" ALTER COLUMN "displayName" SET NOT NULL;

INSERT INTO "Workspace" (id, name, slug, timezone, status, revision, "createdAt", "updatedAt")
SELECT 'legacy-' || t.id, t.name, 'legacy-' || t.id, 'UTC', 'active', 0, NOW(), NOW()
FROM "TeacherProfile" t;

INSERT INTO "LegacyWorkspaceMapping" ("teacherProfileId", "workspaceId")
SELECT t.id, 'legacy-' || t.id FROM "TeacherProfile" t;

INSERT INTO "WorkspaceMembership" (id, "workspaceId", "userId", status, "displayNameOverride", revision, "joinedAt", "createdAt", "updatedAt")
SELECT 'legacy-teacher-' || t.id, m."workspaceId", t."userId", 'active', t.name, 0, NOW(), NOW(), NOW()
FROM "TeacherProfile" t JOIN "LegacyWorkspaceMapping" m ON m."teacherProfileId" = t.id;

INSERT INTO "WorkspaceMembership" (id, "workspaceId", "userId", status, "displayNameOverride", revision, "joinedAt", "suspendedAt", "createdAt", "updatedAt")
SELECT 'legacy-student-' || s.id, m."workspaceId", s."userId",
       CASE WHEN s.access = 'disabled' THEN 'suspended'::"MembershipStatus" ELSE 'active'::"MembershipStatus" END,
       s.name, 0, NOW(), CASE WHEN s.access = 'disabled' THEN NOW() ELSE NULL END, NOW(), NOW()
FROM "StudentProfile" s JOIN "LegacyWorkspaceMapping" m ON m."teacherProfileId" = s."teacherId"
ON CONFLICT ("workspaceId", "userId") DO NOTHING;

INSERT INTO "WorkspaceRoleGrant" (id, "membershipId", role, "grantedAt")
SELECT 'legacy-admin-' || t.id, wm.id, 'admin', NOW()
FROM "TeacherProfile" t JOIN "LegacyWorkspaceMapping" m ON m."teacherProfileId" = t.id
JOIN "WorkspaceMembership" wm ON wm."workspaceId" = m."workspaceId" AND wm."userId" = t."userId";

INSERT INTO "WorkspaceRoleGrant" (id, "membershipId", role, "grantedAt")
SELECT 'legacy-teacher-role-' || t.id, wm.id, 'teacher', NOW()
FROM "TeacherProfile" t JOIN "LegacyWorkspaceMapping" m ON m."teacherProfileId" = t.id
JOIN "WorkspaceMembership" wm ON wm."workspaceId" = m."workspaceId" AND wm."userId" = t."userId";

INSERT INTO "WorkspaceRoleGrant" (id, "membershipId", role, "grantedAt")
SELECT 'legacy-student-role-' || s.id, wm.id, 'student', NOW()
FROM "StudentProfile" s JOIN "LegacyWorkspaceMapping" m ON m."teacherProfileId" = s."teacherId"
JOIN "WorkspaceMembership" wm ON wm."workspaceId" = m."workspaceId" AND wm."userId" = s."userId"
ON CONFLICT ("membershipId", role) DO NOTHING;
