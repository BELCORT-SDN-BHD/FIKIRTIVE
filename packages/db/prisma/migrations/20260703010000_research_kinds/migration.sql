-- research: add RESEARCH_CARD (plan) + RESEARCH_REPORT (result) chat message kinds (siblings of STORYBOARD_CARD)
ALTER TYPE "ChatMessageKind" ADD VALUE 'RESEARCH_CARD';
ALTER TYPE "ChatMessageKind" ADD VALUE 'RESEARCH_REPORT';
