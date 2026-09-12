import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { shotGoesDirectToVideo } from "@fikirtive/core/storyboard-shot";
import { shotsDirectToVideo } from "../storyboard-card";

/**
 * FSE-208(creation §5,S5 批量裁决 2026-09-12 #1358)—— 「有演员＝直接出片」这句判据已经
 * 退场:`shotGoesDirectToVideo` 现在对**任何**镜头都恒真,不再读 castEntityIds。
 *
 * 原文件(`creation §5 :172⑤ ——「有演员＝直接出片」两处同源`)钉的是卡面
 * (`shotsDirectToVideo`)与 Otto 交稿侧(`shotsMissingFirstFramePrompt`)对同一镜头判得
 * 一模一样 —— Otto 侧那道判据闸已随闸①整段报废删除(`packages/otto/src/skills/
 * propose-storyboard.ts` 的 `refuseShotsMissingFirstFramePrompt`,PR #1394 报废清单),
 * 不再有第二个消费方需要对齐,原比对测试没有替代覆盖(报废,不是迁移)。
 *
 * 这里改钉一条更简单也更该长期成立的事实:`shotGoesDirectToVideo`/`shotsDirectToVideo`
 * 对任何镜头形状(带演员、只带商品、什么都不带、空 entityIds、跨租户 id)都恒真 —— 这正是
 * 「纯商品镜头直接出视频」验收句的判据落点。
 */
const CAST = new Set(["actor-1"]); // 这家店活着的演员(服务端按 ownerId 读出来的那一份)——
// 传一个完全不相干的集合进来,答案也不该变,这正是下面要钉的事。

const TABLE: { name: string; shot: { entityIds?: string[] } }[] = [
  { name: "@ 到演员 + 商品", shot: { entityIds: ["actor-1", "mug"] } },
  { name: "只 @ 了商品(纯商品镜头)", shot: { entityIds: ["mug"] } },
  { name: "一个元素都没 @", shot: {} },
  { name: "空的 entityIds", shot: { entityIds: [] } },
  { name: "别家店的演员 id", shot: { entityIds: ["actor-of-other-shop"] } },
];

describe("FSE-208 · 分镜直接出片判据恒真 —— 卡面与判据源同一句话", () => {
  it.each(TABLE)(
    "FSE-208 / CREATE-A2: 任何镜头形状都直接出片,不读 castEntityIds —— $name",
    ({ shot }) => {
      expect(shotGoesDirectToVideo(shot, CAST)).toBe(true);
      expect(shotGoesDirectToVideo(shot, new Set())).toBe(true); // 空集合答案不变

      const withId = { shotId: "s0", ...shot };
      expect(shotsDirectToVideo([withId], CAST).map((s) => s.shotId)).toEqual(["s0"]);
    },
  );

  it("FSE-208: 卡面读的就是 core 里那唯一一个判据函数,不自己再写一遍", () => {
    const root = path.resolve(__dirname, "../../../..");
    const web = readFileSync(path.join(root, "apps/web/lib/storyboard-card.ts"), "utf8");
    expect(web).toContain("shotGoesDirectToVideo");
    expect(web, "storyboard-card.ts 又自己写了一遍判词").not.toMatch(/castEntityIds\.has\(/u);
  });
});
