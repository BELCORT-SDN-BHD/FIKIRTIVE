-- C7-M1 (2026-07-22): additive-only workflows/lifecycle storage.
-- docs/superpowers/specs/2026-07-22-c7-workflows-lifecycle-physical-contract.md §7.
-- Adds seven owner-scoped carriers, two safe candidate keys on existing tables, and only the
-- constraints/triggers needed to preserve the frozen revision, authorization, tenant, and
-- exactly-once storage contract. No rows are migrated; no runtime, sender, provider, receipt,
-- outbox, consent/frequency writer, attribution table, retention job, or spend path is enabled.

BEGIN;

-- CreateTable
CREATE TABLE "WorkflowDefinition" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "definitionKind" TEXT NOT NULL,
    "originKind" TEXT NOT NULL,
    "recipeKey" TEXT,
    "recipeCatalogVersion" TEXT,
    "currentRevision" INTEGER,
    "rowRevision" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdByMembershipId" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowDefinition_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WorkflowDefinition_kind_check" CHECK ("definitionKind" IN ('rule', 'journey')),
    CONSTRAINT "WorkflowDefinition_origin_check" CHECK ("originKind" IN ('custom', 'inbox_recipe')),
    CONSTRAINT "WorkflowDefinition_status_check" CHECK ("status" IN ('draft', 'published', 'archived')),
    CONSTRAINT "WorkflowDefinition_row_revision_check" CHECK ("rowRevision" >= 0),
    CONSTRAINT "WorkflowDefinition_recipe_refs_check" CHECK (
        "originKind" <> 'inbox_recipe'
        OR ("recipeKey" IS NOT NULL AND "recipeCatalogVersion" IS NOT NULL)
    ),
    CONSTRAINT "WorkflowDefinition_published_revision_check" CHECK (
        "status" <> 'published' OR "currentRevision" IS NOT NULL
    )
);

-- CreateTable
CREATE TABLE "WorkflowRevision" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "workflowDefinitionId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "formatVersion" TEXT NOT NULL,
    "rulesSource" TEXT NOT NULL,
    "compiledRuleJson" JSONB NOT NULL,
    "dependencyManifestJson" JSONB NOT NULL,
    "dependencyHash" TEXT NOT NULL,
    "compilerVersion" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "validationState" TEXT NOT NULL,
    "validationErrorsJson" JSONB NOT NULL,
    "createdByMembershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowRevision_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WorkflowRevision_revision_check" CHECK ("revision" >= 1),
    CONSTRAINT "WorkflowRevision_format_check" CHECK ("formatVersion" = 'fikirtive-workflow/v1'),
    CONSTRAINT "WorkflowRevision_validation_state_check" CHECK (
        "validationState" IN ('valid', 'invalid', 'unavailable')
    )
);

-- CreateTable
CREATE TABLE "Routine" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "workflowDefinitionId" TEXT NOT NULL,
    "workflowRevisionId" TEXT NOT NULL,
    "routineKey" TEXT NOT NULL,
    "supersedesRoutineId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "scopeJson" JSONB NOT NULL,
    "scopeHash" TEXT NOT NULL,
    "maxCreditsPerRun" INTEGER NOT NULL,
    "maxCreditsPerMonth" INTEGER NOT NULL,
    "summaryPolicyJson" JSONB NOT NULL,
    "authorizationRevision" INTEGER NOT NULL,
    "authorizationHash" TEXT,
    "authorizedByMembershipId" TEXT,
    "authorizedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "killSwitchEngaged" BOOLEAN NOT NULL DEFAULT false,
    "killedByMembershipId" TEXT,
    "killedAt" TIMESTAMP(3),
    "killReasonCode" TEXT,
    "rowRevision" INTEGER NOT NULL DEFAULT 0,
    "createdByMembershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Routine_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Routine_status_check" CHECK (
        "status" IN ('draft', 'active', 'paused', 'revoked', 'expired')
    ),
    CONSTRAINT "Routine_nonnegative_budget_check" CHECK (
        "maxCreditsPerRun" >= 0 AND "maxCreditsPerMonth" >= 0
    ),
    CONSTRAINT "Routine_authorization_revision_check" CHECK ("authorizationRevision" >= 1),
    CONSTRAINT "Routine_row_revision_check" CHECK ("rowRevision" >= 0),
    CONSTRAINT "Routine_active_authorization_check" CHECK (
        "status" <> 'active'
        OR (
            "authorizationHash" IS NOT NULL
            AND "authorizedByMembershipId" IS NOT NULL
            AND "authorizedAt" IS NOT NULL
        )
    )
);

-- CreateTable
CREATE TABLE "RoutineRun" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "routineId" TEXT NOT NULL,
    "routineKey" TEXT NOT NULL,
    "workflowDefinitionId" TEXT NOT NULL,
    "workflowRevisionId" TEXT NOT NULL,
    "contactJourneyStateId" TEXT,
    "triggerKind" TEXT NOT NULL,
    "triggerOccurrenceRef" TEXT NOT NULL,
    "triggerEventRef" TEXT,
    "scheduledFor" TIMESTAMPTZ(6),
    "runIdempotencyKey" TEXT NOT NULL,
    "triggerPayloadHash" TEXT NOT NULL,
    "authorizationRevision" INTEGER NOT NULL,
    "authorizationHash" TEXT NOT NULL,
    "authorizationSnapshotJson" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "currentStepKey" TEXT,
    "rowRevision" INTEGER NOT NULL DEFAULT 0,
    "simulated" BOOLEAN NOT NULL DEFAULT true,
    "reservedCredits" INTEGER NOT NULL DEFAULT 0,
    "settledCredits" INTEGER NOT NULL DEFAULT 0,
    "creditReservationRef" TEXT,
    "summaryJson" JSONB,
    "blockReason" TEXT,
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoutineRun_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RoutineRun_trigger_kind_check" CHECK (
        "triggerKind" IN ('manual', 'schedule', 'customer_message', 'journey_due')
    ),
    CONSTRAINT "RoutineRun_status_check" CHECK (
        "status" IN ('queued', 'running', 'waiting', 'completed', 'blocked', 'cancelled', 'failed')
    ),
    CONSTRAINT "RoutineRun_revision_counter_check" CHECK (
        "authorizationRevision" >= 1 AND "rowRevision" >= 0
    ),
    CONSTRAINT "RoutineRun_credit_summary_check" CHECK (
        "reservedCredits" >= 0 AND "settledCredits" >= 0
    ),
    CONSTRAINT "RoutineRun_simulated_era_check" CHECK (
        "simulated" AND "reservedCredits" = 0 AND "settledCredits" = 0
        AND "creditReservationRef" IS NULL
    ),
    CONSTRAINT "RoutineRun_trigger_shape_check" CHECK (
        ("triggerKind" = 'manual' AND "triggerOccurrenceRef" ~ '^manual:.+$' AND "scheduledFor" IS NULL AND "triggerEventRef" IS NULL)
        OR ("triggerKind" = 'schedule' AND "triggerOccurrenceRef" ~ '^schedule:.+$' AND "scheduledFor" IS NOT NULL AND "triggerEventRef" IS NULL AND "contactJourneyStateId" IS NULL)
        OR ("triggerKind" = 'customer_message' AND "triggerOccurrenceRef" ~ '^message:.+$' AND "scheduledFor" IS NULL AND "triggerEventRef" IS NOT NULL)
        OR ("triggerKind" = 'journey_due' AND "triggerOccurrenceRef" ~ '^journey:.+$' AND "scheduledFor" IS NULL AND "triggerEventRef" IS NULL AND "contactJourneyStateId" IS NOT NULL)
    ),
    CONSTRAINT "RoutineRun_finished_terminal_check" CHECK (
        "finishedAt" IS NULL OR "status" IN ('completed', 'blocked', 'cancelled', 'failed')
    )
);

-- CreateTable
CREATE TABLE "ContactJourneyState" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "contactIdentityId" TEXT,
    "workflowDefinitionId" TEXT NOT NULL,
    "workflowRevisionId" TEXT NOT NULL,
    "routineId" TEXT NOT NULL,
    "enrollmentIdempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "currentStepKey" TEXT,
    "nextEligibleAt" TIMESTAMPTZ(6),
    "waitGeneration" INTEGER NOT NULL DEFAULT 0,
    "stateJson" JSONB NOT NULL,
    "lastRoutineRunId" TEXT,
    "rowRevision" INTEGER NOT NULL DEFAULT 0,
    "enrolledAt" TIMESTAMP(3) NOT NULL,
    "terminalAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactJourneyState_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ContactJourneyState_status_check" CHECK (
        "status" IN ('active', 'waiting', 'paused', 'completed', 'exited', 'blocked', 'failed')
    ),
    CONSTRAINT "ContactJourneyState_counter_check" CHECK (
        "waitGeneration" >= 0 AND "rowRevision" >= 0
    ),
    CONSTRAINT "ContactJourneyState_wait_shape_check" CHECK (
        ("status" = 'waiting' AND "nextEligibleAt" IS NOT NULL)
        OR ("status" <> 'waiting' AND "nextEligibleAt" IS NULL)
    ),
    CONSTRAINT "ContactJourneyState_terminal_shape_check" CHECK (
        "terminalAt" IS NULL OR "status" IN ('completed', 'exited', 'blocked', 'failed')
    )
);

-- CreateTable
CREATE TABLE "WorkflowStepExecution" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "routineRunId" TEXT NOT NULL,
    "contactJourneyStateId" TEXT,
    "workflowRevisionId" TEXT NOT NULL,
    "contactId" TEXT,
    "contactIdentityId" TEXT,
    "channel" TEXT,
    "providerConnectionId" TEXT,
    "stepKey" TEXT NOT NULL,
    "actionKind" TEXT NOT NULL,
    "actionPayloadHash" TEXT NOT NULL,
    "stepIdempotencyKey" TEXT NOT NULL,
    "actionIdempotencyKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'reserved',
    "purpose" TEXT,
    "callerClass" TEXT,
    "eligibilityInputHash" TEXT,
    "eligibilityVerdictJson" JSONB,
    "eligibilityVerdictHash" TEXT,
    "downstreamKind" TEXT NOT NULL DEFAULT 'none',
    "downstreamRef" TEXT,
    "simulated" BOOLEAN NOT NULL DEFAULT true,
    "reasonCode" TEXT,
    "errorCode" TEXT,
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delegatedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowStepExecution_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WorkflowStepExecution_action_kind_check" CHECK (
        "actionKind" IN ('conversation_reply', 'broadcast_run', 'wait', 'complete')
    ),
    CONSTRAINT "WorkflowStepExecution_status_check" CHECK (
        "status" IN ('reserved', 'blocked', 'simulated', 'delegated', 'unavailable', 'failed')
    ),
    CONSTRAINT "WorkflowStepExecution_downstream_kind_check" CHECK (
        "downstreamKind" IN ('none', 'conversation_reply', 'broadcast_run')
    ),
    CONSTRAINT "WorkflowStepExecution_simulated_era_check" CHECK ("simulated"),
    CONSTRAINT "WorkflowStepExecution_customer_action_check" CHECK (
        "actionKind" NOT IN ('conversation_reply', 'broadcast_run')
        OR (
            "actionIdempotencyKey" IS NOT NULL
            AND (
                "status" NOT IN ('simulated', 'delegated')
                OR (
                    "contactId" IS NOT NULL
                    AND "contactIdentityId" IS NOT NULL
                    AND "channel" IS NOT NULL
                    AND "purpose" IS NOT NULL
                    AND "callerClass" = 'unconfirmed_automatic'
                    AND "eligibilityInputHash" IS NOT NULL
                    AND "eligibilityVerdictJson" IS NOT NULL
                    AND "eligibilityVerdictHash" IS NOT NULL
                )
            )
        )
    ),
    CONSTRAINT "WorkflowStepExecution_internal_target_check" CHECK (
        "actionKind" IN ('conversation_reply', 'broadcast_run')
        OR ("contactId" IS NULL AND "contactIdentityId" IS NULL)
    )
);

-- CreateTable
CREATE TABLE "BusinessHoursPolicy" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "policyKey" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "supersedesPolicyId" TEXT,
    "name" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL,
    "weeklyWindowsJson" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "rowRevision" INTEGER NOT NULL DEFAULT 0,
    "contentHash" TEXT NOT NULL,
    "createdByMembershipId" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessHoursPolicy_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BusinessHoursPolicy_status_check" CHECK (
        "status" IN ('draft', 'published', 'archived')
    ),
    CONSTRAINT "BusinessHoursPolicy_revision_check" CHECK ("revision" >= 1),
    CONSTRAINT "BusinessHoursPolicy_row_revision_check" CHECK ("rowRevision" >= 0),
    CONSTRAINT "BusinessHoursPolicy_windows_array_check" CHECK (
        jsonb_typeof("weeklyWindowsJson") = 'array'
    )
);

-- CreateIndex: unconditional candidate keys and query indexes.
CREATE UNIQUE INDEX "WorkflowDefinition_id_ownerId_key"
    ON "WorkflowDefinition"("id", "ownerId");
CREATE UNIQUE INDEX "WorkflowRevision_id_ownerId_key"
    ON "WorkflowRevision"("id", "ownerId");
CREATE UNIQUE INDEX "WorkflowRevision_id_owner_definition_key"
    ON "WorkflowRevision"("id", "ownerId", "workflowDefinitionId");
CREATE UNIQUE INDEX "WorkflowRevision_owner_definition_revision_key"
    ON "WorkflowRevision"("ownerId", "workflowDefinitionId", "revision");
CREATE UNIQUE INDEX "WorkflowRevision_owner_definition_content_key"
    ON "WorkflowRevision"("ownerId", "workflowDefinitionId", "contentHash");

CREATE UNIQUE INDEX "Routine_id_ownerId_key" ON "Routine"("id", "ownerId");
CREATE UNIQUE INDEX "Routine_id_owner_definition_key"
    ON "Routine"("id", "ownerId", "workflowDefinitionId");
CREATE UNIQUE INDEX "Routine_id_owner_revision_key"
    ON "Routine"("id", "ownerId", "workflowRevisionId");
CREATE UNIQUE INDEX "Routine_id_owner_key_definition_key"
    ON "Routine"("id", "ownerId", "routineKey", "workflowDefinitionId");
CREATE UNIQUE INDEX "Routine_id_owner_definition_revision_key"
    ON "Routine"("id", "ownerId", "workflowDefinitionId", "workflowRevisionId");
CREATE UNIQUE INDEX "Routine_id_owner_key_definition_revision_key"
    ON "Routine"("id", "ownerId", "routineKey", "workflowDefinitionId", "workflowRevisionId");
CREATE UNIQUE INDEX "Routine_authorization_proof_key"
    ON "Routine"(
        "id", "ownerId", "routineKey", "workflowDefinitionId", "workflowRevisionId",
        "authorizationRevision", "authorizationHash"
    );
CREATE UNIQUE INDEX "Routine_owner_definition_key_authorization_revision_key"
    ON "Routine"("ownerId", "workflowDefinitionId", "routineKey", "authorizationRevision");

CREATE UNIQUE INDEX "RoutineRun_id_ownerId_key" ON "RoutineRun"("id", "ownerId");
CREATE UNIQUE INDEX "RoutineRun_id_owner_revision_key"
    ON "RoutineRun"("id", "ownerId", "workflowRevisionId");
CREATE UNIQUE INDEX "RoutineRun_id_owner_journey_key"
    ON "RoutineRun"("id", "ownerId", "contactJourneyStateId");
CREATE UNIQUE INDEX "RoutineRun_id_owner_revision_journey_key"
    ON "RoutineRun"("id", "ownerId", "workflowRevisionId", "contactJourneyStateId");
CREATE UNIQUE INDEX "RoutineRun_ownerId_runIdempotencyKey_key"
    ON "RoutineRun"("ownerId", "runIdempotencyKey");

CREATE UNIQUE INDEX "ContactJourneyState_id_ownerId_key"
    ON "ContactJourneyState"("id", "ownerId");
CREATE UNIQUE INDEX "ContactJourneyState_id_owner_revision_key"
    ON "ContactJourneyState"("id", "ownerId", "workflowRevisionId");
CREATE UNIQUE INDEX "ContactJourneyState_id_owner_routine_revision_key"
    ON "ContactJourneyState"("id", "ownerId", "routineId", "workflowRevisionId");
CREATE UNIQUE INDEX "ContactJourneyState_ownerId_enrollmentIdempotencyKey_key"
    ON "ContactJourneyState"("ownerId", "enrollmentIdempotencyKey");

CREATE UNIQUE INDEX "WorkflowStepExecution_id_ownerId_key"
    ON "WorkflowStepExecution"("id", "ownerId");
CREATE UNIQUE INDEX "WorkflowStepExecution_ownerId_stepIdempotencyKey_key"
    ON "WorkflowStepExecution"("ownerId", "stepIdempotencyKey");

CREATE UNIQUE INDEX "BusinessHoursPolicy_id_ownerId_key"
    ON "BusinessHoursPolicy"("id", "ownerId");
CREATE UNIQUE INDEX "BusinessHoursPolicy_id_owner_policy_key"
    ON "BusinessHoursPolicy"("id", "ownerId", "policyKey");
CREATE UNIQUE INDEX "BusinessHoursPolicy_ownerId_policyKey_revision_key"
    ON "BusinessHoursPolicy"("ownerId", "policyKey", "revision");
CREATE UNIQUE INDEX "BusinessHoursPolicy_ownerId_policyKey_contentHash_key"
    ON "BusinessHoursPolicy"("ownerId", "policyKey", "contentHash");

CREATE INDEX "WorkflowDefinition_owner_status_updated_idx"
    ON "WorkflowDefinition"("ownerId", "status", "updatedAt", "id");
CREATE INDEX "WorkflowRevision_owner_definition_revision_idx"
    ON "WorkflowRevision"("ownerId", "workflowDefinitionId", "revision", "id");
CREATE INDEX "Routine_owner_status_expires_idx"
    ON "Routine"("ownerId", "status", "expiresAt", "id");
CREATE INDEX "Routine_owner_definition_status_idx"
    ON "Routine"("ownerId", "workflowDefinitionId", "status", "id");
CREATE INDEX "RoutineRun_owner_routine_status_created_idx"
    ON "RoutineRun"("ownerId", "routineId", "status", "createdAt", "id");
CREATE INDEX "RoutineRun_owner_status_scheduled_idx"
    ON "RoutineRun"("ownerId", "status", "scheduledFor", "id");
CREATE INDEX "ContactJourneyState_owner_status_due_idx"
    ON "ContactJourneyState"("ownerId", "status", "nextEligibleAt", "id");
CREATE INDEX "ContactJourneyState_owner_contact_updated_idx"
    ON "ContactJourneyState"("ownerId", "contactId", "updatedAt", "id");
CREATE INDEX "WorkflowStepExecution_owner_run_status_idx"
    ON "WorkflowStepExecution"("ownerId", "routineRunId", "status", "id");
CREATE INDEX "WorkflowStepExecution_owner_journey_created_idx"
    ON "WorkflowStepExecution"("ownerId", "contactJourneyStateId", "createdAt", "id");
CREATE INDEX "BusinessHoursPolicy_owner_policy_revision_idx"
    ON "BusinessHoursPolicy"("ownerId", "policyKey", "revision", "id");
CREATE INDEX "BusinessHoursPolicy_owner_status_updated_idx"
    ON "BusinessHoursPolicy"("ownerId", "status", "updatedAt", "id");

-- CreateIndex: required partial uniqueness that Prisma cannot express.
CREATE UNIQUE INDEX "WorkflowDefinition_owner_slug_live_key"
    ON "WorkflowDefinition"("ownerId", "slug")
    WHERE "archivedAt" IS NULL;
CREATE UNIQUE INDEX "Routine_owner_definition_key_active_key"
    ON "Routine"("ownerId", "workflowDefinitionId", "routineKey")
    WHERE "status" = 'active';
CREATE UNIQUE INDEX "WorkflowStepExecution_owner_action_live_key"
    ON "WorkflowStepExecution"("ownerId", "actionIdempotencyKey")
    WHERE "actionIdempotencyKey" IS NOT NULL;

-- CreateIndex: additive candidate keys on existing tables. Each begins with the existing globally
-- unique primary-key id, so it cannot reject or rewrite any existing row.
CREATE UNIQUE INDEX "ContactIdentity_id_contactId_ownerId_channel_key"
    ON "ContactIdentity"("id", "contactId", "ownerId", "channel");
CREATE UNIQUE INDEX "ChannelConnection_id_ownerId_kind_key"
    ON "ChannelConnection"("id", "ownerId", "kind");

-- AddForeignKey: tenant roots and human membership facts.
ALTER TABLE "WorkflowDefinition" ADD CONSTRAINT "WorkflowDefinition_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowDefinition" ADD CONSTRAINT "WorkflowDefinition_created_by_owner_fkey"
    FOREIGN KEY ("createdByMembershipId", "ownerId") REFERENCES "Membership"("id", "orgId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkflowRevision" ADD CONSTRAINT "WorkflowRevision_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowRevision" ADD CONSTRAINT "WorkflowRevision_definition_owner_fkey"
    FOREIGN KEY ("workflowDefinitionId", "ownerId") REFERENCES "WorkflowDefinition"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowRevision" ADD CONSTRAINT "WorkflowRevision_created_by_owner_fkey"
    FOREIGN KEY ("createdByMembershipId", "ownerId") REFERENCES "Membership"("id", "orgId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Routine" ADD CONSTRAINT "Routine_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Routine" ADD CONSTRAINT "Routine_workflow_definition_owner_fkey"
    FOREIGN KEY ("workflowDefinitionId", "ownerId") REFERENCES "WorkflowDefinition"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Routine" ADD CONSTRAINT "Routine_workflow_revision_definition_fkey"
    FOREIGN KEY ("workflowRevisionId", "ownerId", "workflowDefinitionId") REFERENCES "WorkflowRevision"("id", "ownerId", "workflowDefinitionId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Routine" ADD CONSTRAINT "Routine_supersedes_owner_key_fkey"
    FOREIGN KEY ("supersedesRoutineId", "ownerId", "routineKey", "workflowDefinitionId") REFERENCES "Routine"("id", "ownerId", "routineKey", "workflowDefinitionId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Routine" ADD CONSTRAINT "Routine_authorized_by_owner_fkey"
    FOREIGN KEY ("authorizedByMembershipId", "ownerId") REFERENCES "Membership"("id", "orgId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Routine" ADD CONSTRAINT "Routine_killed_by_owner_fkey"
    FOREIGN KEY ("killedByMembershipId", "ownerId") REFERENCES "Membership"("id", "orgId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Routine" ADD CONSTRAINT "Routine_created_by_owner_fkey"
    FOREIGN KEY ("createdByMembershipId", "ownerId") REFERENCES "Membership"("id", "orgId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RoutineRun" ADD CONSTRAINT "RoutineRun_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RoutineRun" ADD CONSTRAINT "RoutineRun_routine_authorization_fkey"
    FOREIGN KEY (
        "routineId", "ownerId", "routineKey", "workflowDefinitionId", "workflowRevisionId",
        "authorizationRevision", "authorizationHash"
    ) REFERENCES "Routine"(
        "id", "ownerId", "routineKey", "workflowDefinitionId", "workflowRevisionId",
        "authorizationRevision", "authorizationHash"
    ) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContactJourneyState" ADD CONSTRAINT "ContactJourneyState_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContactJourneyState" ADD CONSTRAINT "ContactJourneyState_contactId_ownerId_fkey"
    FOREIGN KEY ("contactId", "ownerId") REFERENCES "Contact"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContactJourneyState" ADD CONSTRAINT "ContactJourneyState_identity_contact_owner_fkey"
    FOREIGN KEY ("contactIdentityId", "contactId", "ownerId") REFERENCES "ContactIdentity"("id", "contactId", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContactJourneyState" ADD CONSTRAINT "ContactJourneyState_workflow_revision_fkey"
    FOREIGN KEY ("workflowRevisionId", "ownerId", "workflowDefinitionId") REFERENCES "WorkflowRevision"("id", "ownerId", "workflowDefinitionId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContactJourneyState" ADD CONSTRAINT "ContactJourneyState_routine_revision_fkey"
    FOREIGN KEY ("routineId", "ownerId", "workflowRevisionId") REFERENCES "Routine"("id", "ownerId", "workflowRevisionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Circular Journey/Run cursor relations are added only after both tables and all candidate keys exist.
ALTER TABLE "RoutineRun" ADD CONSTRAINT "RoutineRun_journey_routine_revision_fkey"
    FOREIGN KEY ("contactJourneyStateId", "ownerId", "routineId", "workflowRevisionId") REFERENCES "ContactJourneyState"("id", "ownerId", "routineId", "workflowRevisionId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContactJourneyState" ADD CONSTRAINT "ContactJourneyState_last_run_owner_fkey"
    FOREIGN KEY ("lastRoutineRunId", "ownerId", "id") REFERENCES "RoutineRun"("id", "ownerId", "contactJourneyStateId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkflowStepExecution" ADD CONSTRAINT "WorkflowStepExecution_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowStepExecution" ADD CONSTRAINT "WorkflowStepExecution_run_revision_fkey"
    FOREIGN KEY ("routineRunId", "ownerId", "workflowRevisionId") REFERENCES "RoutineRun"("id", "ownerId", "workflowRevisionId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowStepExecution" ADD CONSTRAINT "WorkflowStepExecution_run_journey_revision_fkey"
    FOREIGN KEY ("routineRunId", "ownerId", "workflowRevisionId", "contactJourneyStateId") REFERENCES "RoutineRun"("id", "ownerId", "workflowRevisionId", "contactJourneyStateId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowStepExecution" ADD CONSTRAINT "WorkflowStepExecution_journey_revision_fkey"
    FOREIGN KEY ("contactJourneyStateId", "ownerId", "workflowRevisionId") REFERENCES "ContactJourneyState"("id", "ownerId", "workflowRevisionId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowStepExecution" ADD CONSTRAINT "WorkflowStepExecution_contactId_ownerId_fkey"
    FOREIGN KEY ("contactId", "ownerId") REFERENCES "Contact"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowStepExecution" ADD CONSTRAINT "WorkflowStepExecution_identity_channel_fkey"
    FOREIGN KEY ("contactIdentityId", "contactId", "ownerId", "channel") REFERENCES "ContactIdentity"("id", "contactId", "ownerId", "channel") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowStepExecution" ADD CONSTRAINT "WorkflowStepExecution_connection_channel_fkey"
    FOREIGN KEY ("providerConnectionId", "ownerId", "channel") REFERENCES "ChannelConnection"("id", "ownerId", "kind") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BusinessHoursPolicy" ADD CONSTRAINT "BusinessHoursPolicy_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BusinessHoursPolicy" ADD CONSTRAINT "BusinessHoursPolicy_supersedes_owner_key_fkey"
    FOREIGN KEY ("supersedesPolicyId", "ownerId", "policyKey") REFERENCES "BusinessHoursPolicy"("id", "ownerId", "policyKey") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BusinessHoursPolicy" ADD CONSTRAINT "BusinessHoursPolicy_created_by_owner_fkey"
    FOREIGN KEY ("createdByMembershipId", "ownerId") REFERENCES "Membership"("id", "orgId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Definition's nullable current pointer is added after WorkflowRevision exists, completing the exact
-- owner + Definition + revision bind without making draft Definitions impossible to create.
ALTER TABLE "WorkflowDefinition" ADD CONSTRAINT "WorkflowDefinition_current_revision_fkey"
    FOREIGN KEY ("ownerId", "id", "currentRevision") REFERENCES "WorkflowRevision"("ownerId", "workflowDefinitionId", "revision") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Frozen WorkflowRevision rows cannot be edited in place. A material save inserts a new revision.
CREATE FUNCTION "c7_reject_workflow_revision_update"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'WorkflowRevision is immutable; insert a new revision'
        USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "WorkflowRevision_immutable_update"
BEFORE UPDATE ON "WorkflowRevision"
FOR EACH ROW EXECUTE FUNCTION "c7_reject_workflow_revision_update"();

-- Once a Routine has authorization facts, the standing envelope is immutable. Only status/kill/CAS
-- lifecycle fields may change; reauthorization inserts a new superseding Routine row.
CREATE FUNCTION "c7_guard_routine_authorization_update"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD."authorizedAt" IS NOT NULL OR OLD."authorizationHash" IS NOT NULL THEN
        IF NEW."ownerId" IS DISTINCT FROM OLD."ownerId"
           OR NEW."workflowDefinitionId" IS DISTINCT FROM OLD."workflowDefinitionId"
           OR NEW."workflowRevisionId" IS DISTINCT FROM OLD."workflowRevisionId"
           OR NEW."routineKey" IS DISTINCT FROM OLD."routineKey"
           OR NEW."supersedesRoutineId" IS DISTINCT FROM OLD."supersedesRoutineId"
           OR NEW."scopeJson" IS DISTINCT FROM OLD."scopeJson"
           OR NEW."scopeHash" IS DISTINCT FROM OLD."scopeHash"
           OR NEW."maxCreditsPerRun" IS DISTINCT FROM OLD."maxCreditsPerRun"
           OR NEW."maxCreditsPerMonth" IS DISTINCT FROM OLD."maxCreditsPerMonth"
           OR NEW."summaryPolicyJson" IS DISTINCT FROM OLD."summaryPolicyJson"
           OR NEW."authorizationRevision" IS DISTINCT FROM OLD."authorizationRevision"
           OR NEW."authorizationHash" IS DISTINCT FROM OLD."authorizationHash"
           OR NEW."authorizedByMembershipId" IS DISTINCT FROM OLD."authorizedByMembershipId"
           OR NEW."authorizedAt" IS DISTINCT FROM OLD."authorizedAt"
           OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
           OR NEW."createdByMembershipId" IS DISTINCT FROM OLD."createdByMembershipId"
           OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
            RAISE EXCEPTION 'authorized Routine envelope is immutable; insert a superseding row'
                USING ERRCODE = '55000';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "Routine_authorization_immutable_update"
BEFORE UPDATE ON "Routine"
FOR EACH ROW EXECUTE FUNCTION "c7_guard_routine_authorization_update"();

-- A new Run may exist only while its exact Routine envelope is live and not killed. The composite FK
-- separately proves revision/hash identity; this trigger enforces the mutable status/kill/expiry gate.
CREATE FUNCTION "c7_validate_new_routine_run"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM 1
        FROM "Routine" AS routine
        WHERE routine."id" = NEW."routineId"
          AND routine."ownerId" = NEW."ownerId"
          AND routine."routineKey" = NEW."routineKey"
          AND routine."workflowDefinitionId" = NEW."workflowDefinitionId"
          AND routine."workflowRevisionId" = NEW."workflowRevisionId"
          AND routine."authorizationRevision" = NEW."authorizationRevision"
          AND routine."authorizationHash" = NEW."authorizationHash"
          AND routine."status" = 'active'
          AND routine."killSwitchEngaged" = false
          -- statement_timestamp(), unlike CURRENT_TIMESTAMP, is not frozen at transaction start.
          AND (routine."expiresAt" IS NULL OR routine."expiresAt" > statement_timestamp())
        -- A kill/status UPDATE changes non-key columns, so KEY SHARE is insufficient here.
        -- FOR UPDATE serializes this check with the fail-safe mutation: whichever commits first
        -- determines whether this Run may be inserted.
        FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Routine authority is inactive, killed, expired, or drifted'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "RoutineRun_live_authority_insert"
BEFORE INSERT ON "RoutineRun"
FOR EACH ROW EXECUTE FUNCTION "c7_validate_new_routine_run"();

-- Published policy content is immutable. Archive/status/CAS fields may change; editing content inserts
-- a new policy revision and links it through supersedesPolicyId.
CREATE FUNCTION "c7_guard_business_hours_policy_update"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD."status" IN ('published', 'archived') THEN
        IF NEW."ownerId" IS DISTINCT FROM OLD."ownerId"
           OR NEW."policyKey" IS DISTINCT FROM OLD."policyKey"
           OR NEW."revision" IS DISTINCT FROM OLD."revision"
           OR NEW."supersedesPolicyId" IS DISTINCT FROM OLD."supersedesPolicyId"
           OR NEW."name" IS DISTINCT FROM OLD."name"
           OR NEW."timeZone" IS DISTINCT FROM OLD."timeZone"
           OR NEW."weeklyWindowsJson" IS DISTINCT FROM OLD."weeklyWindowsJson"
           OR NEW."contentHash" IS DISTINCT FROM OLD."contentHash"
           OR NEW."createdByMembershipId" IS DISTINCT FROM OLD."createdByMembershipId"
           OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
            RAISE EXCEPTION 'published BusinessHoursPolicy content is immutable; insert a new revision'
                USING ERRCODE = '55000';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "BusinessHoursPolicy_published_content_update"
BEFORE UPDATE ON "BusinessHoursPolicy"
FOR EACH ROW EXECUTE FUNCTION "c7_guard_business_hours_policy_update"();

COMMIT;
