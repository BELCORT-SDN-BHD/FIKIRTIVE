-- cowork context-store seams: 4 additive nullable columns, zero data loss.
-- Project.coworkBrief: human-authored creative brief injected into the planner's stable head.
ALTER TABLE "Project" ADD COLUMN "coworkBrief" TEXT;

-- Entity.descriptionJson: reserved — structured see-once description (Phase C).
ALTER TABLE "Entity" ADD COLUMN "descriptionJson" JSONB;

-- EntityVariant.descriptionJson: reserved — per-variant structured description (Phase C).
ALTER TABLE "EntityVariant" ADD COLUMN "descriptionJson" JSONB;

-- ChatThread.rollingSummary: reserved — folded older-turns summary (Phase C).
ALTER TABLE "ChatThread" ADD COLUMN "rollingSummary" TEXT;
