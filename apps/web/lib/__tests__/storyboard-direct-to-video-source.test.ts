import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { shotGoesDirectToVideo } from "@fikirtive/core/storyboard-shot";
import { shotsDirectToVideo } from "../storyboard-card";
// 判官第 2 轮 P2-⑤:Otto 交稿那一刻的判据。桶文件不导出它(它只服务 propose-storyboard),
// 所以这里按文件路径直取 —— 这一条测的正是「这个文件里的判据和卡面的是同一句话」。
import { shotsMissingFirstFramePrompt } from "../../../../packages/otto/src/skills/propose-storyboard.helpers";

/**
 * creation §5 :172⑤ ——「有演员＝直接出片」这句话**只有一份**。
 *
 * 两个消费方:
 *   • Otto 交稿那一刻 `shotsMissingFirstFramePrompt`(packages/otto)判「这一镜要不要写
 *     首帧文字」;
 *   • 卡面与铸卡侧 `shotsDirectToVideo`(apps/web/lib/storyboard-card.ts)判「这一镜要不要
 *     铸首帧子卡」。
 *
 * 分家的代价是可以算出来的:放行的类别一旦大于免写的类别,就会有一种镜头合法落库 ——
 * 既不直接出片(闸① 要为它铸首帧)、又没有首帧文字(`firstFramePromptOf` 抛拒绝)——
 * 于是**整张卡**的首帧一起铸不出来。所以这一条按同一张镜头表把两边都跑一遍,断言逐格互补。
 */
const CAST = new Set(["actor-1"]); // 这家店活着的演员(服务端按 ownerId 读出来的那一份)

/** 覆盖登记口径里点过名的每一种形状。 */
const TABLE: { name: string; shot: { firstFramePrompt?: string; entityIds?: string[] }; direct: boolean }[] = [
  { name: "@ 到演员 + 商品(正路)", shot: { entityIds: ["actor-1", "mug"] }, direct: true },
  { name: "只 @ 了商品(产品特写,照旧两步)", shot: { firstFramePrompt: "ff", entityIds: ["mug"] }, direct: false },
  { name: "一个元素都没 @(照旧两步)", shot: { firstFramePrompt: "ff" }, direct: false },
  { name: "空的 entityIds", shot: { firstFramePrompt: "ff", entityIds: [] }, direct: false },
  // 跨租户/已删的演员 id 根本进不了 CAST ⇒ 这里数出 0 ⇒ 那一镜照旧要首帧文字。
  { name: "别家店的演员 id", shot: { firstFramePrompt: "ff", entityIds: ["actor-of-other-shop"] }, direct: false },
];

describe("creation §5 :172⑤ ——「有演员＝直接出片」两处同源", () => {
  it.each(TABLE)(
    "creation §5 :172⑤ / CREATE-A2: 卡面与 Otto 交稿侧对同一镜头判得一模一样 —— $name",
    ({ shot, direct }) => {
      expect(shotGoesDirectToVideo(shot, CAST)).toBe(direct);

      // 卡面/铸卡侧:直接出片的镜头进这个集合。
      const withId = { shotId: "s0", ...shot };
      expect(shotsDirectToVideo([withId], CAST).map((s) => s.shotId)).toEqual(direct ? ["s0"] : []);

      // Otto 交稿侧:免写首帧文字的**当且仅当**是直接出片那一档(把文字拿掉再问一次)。
      const bare = { ...shot, firstFramePrompt: undefined };
      expect(shotsMissingFirstFramePrompt([bare], CAST)).toEqual(direct ? [] : [0]);
    },
  );

  it("creation §5 :172⑤: 两处都 import 同一个判词函数,谁都没有自己再写一遍", () => {
    const root = path.resolve(__dirname, "../../../..");
    const web = readFileSync(path.join(root, "apps/web/lib/storyboard-card.ts"), "utf8");
    const otto = readFileSync(path.join(root, "packages/otto/src/skills/propose-storyboard.helpers.ts"), "utf8");

    expect(web).toContain("shotGoesDirectToVideo");
    expect(otto).toContain("shotGoesDirectToVideo");
    // 判词的那一句(`castEntityIds.has(...)`)只许住在 core 里。
    for (const [name, src] of [["storyboard-card.ts", web], ["propose-storyboard.helpers.ts", otto]] as const) {
      expect(src, `${name} 又自己写了一遍判词`).not.toMatch(/castEntityIds\.has\(/u);
    }
  });
});
