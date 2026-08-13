/**
 * storyboard-edit — re-export 垫片(W-B3-C)。
 * 纯编辑变换本体迁到 packages/otto/src/storyboard-edit.ts,成为**双执行器共同权威**:
 * 人工 server action(storyboard-actions.ts)与 Otto skill(editStoryboard)共用同一套
 * 编辑语义(含 G 闸② 陈旧级联),不可能漂移。本文件保住 web 侧原导入路径与测试,零改动。
 */
export {
  editStaleness,
  applyEditShotPrompt,
  applyAddShot,
  applyDeleteShot,
  applyReorderShots,
  applySetContinuity,
} from "@fikirtive/otto";
export type { ShotPromptPatch, NewShotInput, EditStaleness } from "@fikirtive/otto";
