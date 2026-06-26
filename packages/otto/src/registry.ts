/** The Otto skill registry: the single place skills are collected into the agent + catalog. */
import type { OttoSkill, Cost, Effect, Reach } from "./skill.js";
import { proposeSkill } from "./skills/propose.js";
import { generateSkill } from "./skills/generate.js";
import { updateBriefSkill } from "./skills/update-brief.js";
import { describeRefsSkill } from "./skills/describe-refs.js";
import { setTitleSkill } from "./skills/set-title.js";

/** Add a new skill here (one line). Order is the agent's tool order. */
export const allSkills: OttoSkill[] = [
  proposeSkill,
  generateSkill,
  updateBriefSkill,
  describeRefsSkill,
  setTitleSkill,
];

export interface SkillMeta {
  name: string;
  cost: Cost;
  effect: Effect;
  reach: Reach;
  needsApproval: boolean;
  description: string;
}

export const skillCatalog: SkillMeta[] = allSkills.map((s) => ({
  name: s.name,
  cost: s.cost,
  effect: s.effect,
  reach: s.reach,
  needsApproval: s.needsApproval,
  description: s.description,
}));
