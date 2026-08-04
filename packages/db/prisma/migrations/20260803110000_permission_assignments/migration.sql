-- Multi-role RBAC foundation. Existing single-role values are preserved as the first
-- assignment; the legacy columns remain temporarily for UI/session compatibility.
BEGIN;

CREATE TABLE "UserRole" (
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId", "role")
);

CREATE INDEX "UserRole_role_idx" ON "UserRole"("role");

ALTER TABLE "UserRole"
ADD CONSTRAINT "UserRole_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "UserRole" ("userId", "role")
SELECT
    "id",
    CASE
        WHEN "role" IN ('super-admin', 'ops', 'finance', 'moderator', 'viewer') THEN "role"
        ELSE 'viewer'
    END
FROM "User"
ON CONFLICT DO NOTHING;

CREATE TABLE "MembershipRole" (
    "membershipId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MembershipRole_pkey" PRIMARY KEY ("membershipId", "role")
);

CREATE INDEX "MembershipRole_role_idx" ON "MembershipRole"("role");

ALTER TABLE "MembershipRole"
ADD CONSTRAINT "MembershipRole_membershipId_fkey"
FOREIGN KEY ("membershipId") REFERENCES "Membership"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "MembershipRole" ("membershipId", "role")
SELECT "id", "role"
FROM "Membership"
WHERE "role" IN ('owner', 'admin', 'member', 'creator', 'approver')
ON CONFLICT DO NOTHING;

COMMIT;
