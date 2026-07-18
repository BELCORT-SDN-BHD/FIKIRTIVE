/** The Otto skill registry: the single place skills are collected into the agent + catalog. */
import type { OttoSkill, Cost, Effect, Reach } from "./skill.js";
import { proposeSkill } from "./skills/propose.js";
import { proposePackSkill } from "./skills/propose-pack.js";
import { generateSkill } from "./skills/generate.js";
import { updateBriefSkill } from "./skills/update-brief.js";
import { describeRefsSkill } from "./skills/describe-refs.js";
import { setTitleSkill } from "./skills/set-title.js";
import { rememberBrandFactSkill } from "./skills/remember-brand-fact.js";
import { saveProductSkill } from "./skills/save-product.js";
import { saveCustomerSegmentSkill } from "./skills/save-customer-segment.js";
import { saveOfferSkill } from "./skills/save-offer.js";
import { lookupProductsSkill } from "./skills/lookup-products.js";
import { ingestProductSkill } from "./skills/ingest-product.js";
import { researchWebSkill } from "./skills/research-web.js";
import { metaInsightsSkill } from "./skills/meta-insights.js";
import { metaAdPerformanceSkill } from "./skills/meta-ad-performance.js";
import { metaExpertSkill } from "./skills/meta-expert.js";
import { metaListObjectsSkill } from "./skills/meta-list-objects.js";
import { listMetaPagesSkill } from "./skills/list-meta-pages.js";
import { proposeMetaActionSkill } from "./skills/propose-meta-action.js";
import { proposeAdBuildSkill } from "./skills/propose-ad-build.js";
import { seedreamPromptSkill } from "./skills/seedream-prompt.js";
import { seedancePromptSkill } from "./skills/seedance-prompt.js";
import { proposeStoryboardSkill } from "./skills/propose-storyboard.js";
import { editStoryboardSkill } from "./skills/edit-storyboard.js";
import { proposeResearchSkill } from "./skills/propose-research.js";
import { schedulePostsSkill } from "./skills/schedule-posts.js";
import { approveScheduledPostSkill } from "./skills/approve-scheduled-post.js";
import { cancelScheduledPostSkill } from "./skills/cancel-scheduled-post.js";
import { editScheduledPostSkill } from "./skills/edit-scheduled-post.js";
import { listScheduledPostsSkill } from "./skills/list-scheduled-posts.js";
import { listPublishTargetsSkill } from "./skills/list-publish-targets.js";
import { suggestPostTimesSkill } from "./skills/suggest-post-times.js";
import { sharePostPreviewSkill } from "./skills/share-post-preview.js";
import { manageCanvasSkill } from "./skills/manage-canvas.js";
import { manageProjectsSkill } from "./skills/manage-projects.js";
import { manageEntitiesSkill } from "./skills/manage-entities.js";
import { manageLibrarySkill } from "./skills/manage-library.js";
import { manageBrandMemorySkill } from "./skills/manage-brand-memory.js";
import { proposeIdeasSkill } from "./skills/propose-ideas.js";
import { manageMediaSkill } from "./skills/manage-media.js";
import { renderVideoSkill } from "./skills/render-video.js";
import { importMediaSkill } from "./skills/import-media.js";
import { generateReferencesSkill } from "./skills/generate-references.js";
import { deleteReferenceVariantSkill } from "./skills/delete-reference-variant.js";
import { runFactoryBatchSkill } from "./skills/run-factory-batch.js";
import { readSegmentsSkill } from "./skills/read-segments.js";
import { buildSegmentSkill } from "./skills/build-segment.js";
import { readCampaignsSkill } from "./skills/read-campaigns.js";
import { planCampaignSkill } from "./skills/plan-campaign.js";

/** Add a new skill here (one line). Order is the agent's tool order. */
export const allSkills: OttoSkill[] = [
  proposeSkill,
  proposePackSkill,
  generateSkill,
  updateBriefSkill,
  describeRefsSkill,
  setTitleSkill,
  rememberBrandFactSkill,
  saveProductSkill,
  saveCustomerSegmentSkill,
  saveOfferSkill,
  lookupProductsSkill,
  ingestProductSkill,
  researchWebSkill,
  metaInsightsSkill,
  metaAdPerformanceSkill,
  metaExpertSkill,
  metaListObjectsSkill,
  listMetaPagesSkill,
  proposeMetaActionSkill,
  proposeAdBuildSkill,
  seedreamPromptSkill,
  seedancePromptSkill,
  proposeStoryboardSkill,
  editStoryboardSkill,
  proposeResearchSkill,
  schedulePostsSkill,
  approveScheduledPostSkill,
  cancelScheduledPostSkill,
  editScheduledPostSkill,
  listScheduledPostsSkill,
  listPublishTargetsSkill,
  suggestPostTimesSkill,
  sharePostPreviewSkill,
  manageCanvasSkill,
  manageProjectsSkill,
  manageEntitiesSkill,
  manageLibrarySkill,
  manageBrandMemorySkill,
  proposeIdeasSkill,
  manageMediaSkill,
  renderVideoSkill,
  importMediaSkill,
  generateReferencesSkill,
  deleteReferenceVariantSkill,
  runFactoryBatchSkill,
  readSegmentsSkill,
  buildSegmentSkill,
  readCampaignsSkill,
  planCampaignSkill,
];

export interface SkillMeta {
  name: string;
  cost: Cost;
  effect: Effect;
  reach: Reach;
  needsApproval: boolean;
  description: string;
  requires: { field: string; question: string }[];
}

export const skillCatalog: SkillMeta[] = allSkills.map((s) => ({
  name: s.name,
  cost: s.cost,
  effect: s.effect,
  reach: s.reach,
  needsApproval: s.needsApproval,
  description: s.description,
  requires: s.requires,
}));
