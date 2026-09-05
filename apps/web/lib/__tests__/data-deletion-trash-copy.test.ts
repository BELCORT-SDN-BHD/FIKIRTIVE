/**
 * data-deletion-trash-copy —— 清单 B3 / P1-007 的**对外**那一半(FRONT-A12)。
 *
 * 病灶:`app/legal/data-deletion/page.tsx` 那条「A generated asset in your library」写着
 * 「choose Delete … cannot be undone」。两处都不是实话:
 *   ① 键名早就是 **Move to trash**(`components/asset/DetailPanel.tsx` 的 `confirmDetails`
 *      与那颗按钮同源);
 *   ② 软删有逆动作 `restoreGeneration`,而且商家自己按得到 —— Library 的
 *      More filters → Show → Trash 那一格,点一格就开「Restore this asset?」。
 * 这一页是 Meta 数据删除回调指过来的对外承诺页,所以「不可恢复」这句假话比屏幕上任何一句
 * 都贵。
 *
 * 钉板(都钉商家读得到的字,不钉内部函数):
 *   ① 那一条不许再出现 "cannot be undone",且必须写出真键名 Move to trash;
 *   ② 必须写得出恢复路径,而且路径**从任何一格都走得通** —— More filters 只画在
 *      Generation history / Uploads 两格上(`LibraryView` 的 `showFilters={gridView}`),
 *      所以指路必须先带回 Generation history;
 *   ③ 两句既有事实不许在这次改写里丢:stored file 尚未被自动清理、canvas 卡片仍在并显示
 *      Preview missing;
 *   ④ 一个保留天数都不许承诺(全仓没有清扫任务硬删这些行,没有单一来源的天数可引用);
 *   ⑤ 详情面确认框那一句同样不许把商家指到一个在 Favorites / Collections 上不存在的控件;
 *   ⑥ 讲完回收站要指得出「真要抹掉这条记录」的两条路(删所属 campaign / 账户删除),
 *      否则这一页对永久删除是沉默的(判官 #1238 P2)。
 *
 * 变异自查(逐一实做、做完还原,红→绿):
 *   - 把页面那一条改回 "choose Delete … cannot be undone" ⇒ ① 两条一起红;
 *   - 把恢复路径里的 "Generation history" 删掉 ⇒ ② 红;
 *   - 把 `DetailPanel` 的 description 改回 "open More filters → Show → Trash" ⇒ ⑤ 红;
 *   - 在页面那一条里写 "30 days" ⇒ ④ 红。
 *
 * 写法照 `library-guardrails-934.test.ts`(断言落在屏幕上的字、且 `not.toContain`
 * "cannot be undone")与 `library-real-route-986.test.ts`(先剥注释,注释里的历史不算屏幕)。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(__dirname, "../..");
const read = (relative: string) => fs.readFileSync(path.join(WEB_ROOT, relative), "utf8");

/** 注释里的路径与历史不是屏幕上的字 —— 判定前先剥掉。 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** JSX → 商家真正读到的一行字:先还原 `{" "}`,再剥标签,再压空白。 */
const visibleText = (source: string) =>
  stripComments(source)
    .replace(/\{"\s*"\}/g, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const PAGE = "app/legal/data-deletion/page.tsx";
const DETAIL_PANEL = "components/asset/DetailPanel.tsx";

/** 只取「A generated asset in your library」那一条 —— 到下一条 bullet 为止。 */
function libraryAssetBullet(): string {
  const text = visibleText(read(PAGE));
  const start = text.indexOf("A generated asset in your library.");
  expect(start, "data-deletion 页上找不到 library asset 那一条 bullet").toBeGreaterThan(-1);
  const end = text.indexOf("A saved reference.", start);
  expect(end, "library asset bullet 后面找不到 saved reference 那一条").toBeGreaterThan(start);
  return text.slice(start, end);
}

describe("FRONT-A12 · /legal/data-deletion 的删素材那一条说的是实话", () => {
  it("FRONT-A12 · 不再写 cannot be undone,键名是 Move to trash", () => {
    const bullet = libraryAssetBullet();
    expect(bullet.toLowerCase()).not.toContain("cannot be undone");
    expect(bullet).toContain("Move to trash");
  });

  it("FRONT-A12 · 写得出恢复路径,而且路径从任何一格都走得通(先回 Generation history)", () => {
    const bullet = libraryAssetBullet();
    for (const step of ["Library", "Generation history", "More filters", "Show", "Trash", "Restore"]) {
      expect(bullet, `恢复路径缺一步:${step}`).toContain(step);
    }
    // More filters 只在 gridView 那两格上,所以 Generation history 必须排在它前面 ——
    // 顺序错了就是把商家指到一个当下不存在的控件上。
    expect(bullet.indexOf("Generation history")).toBeLessThan(bullet.indexOf("More filters"));
  });

  it("FRONT-A12 · 两句既有事实没在改写里丢:stored file 未清理、canvas 卡片显示 Preview missing", () => {
    const bullet = libraryAssetBullet();
    expect(bullet).toContain("not yet removed by an automatic clean-up job");
    expect(bullet).toContain("Preview missing");
  });

  it("FRONT-A12 · 指得出真能把这条记录抹掉的两条路(删所属 campaign / 账户删除)", () => {
    // 判官 #1238 P2:这一条把「回收站」讲得很清楚,却没说「那我要真删掉呢」往哪走 ——
    // 商家读完只知道东西还在。产品里真会硬删这行的只有两条路:
    //   ① `deleteProject`(`lib/actions.ts`)在同一笔事务里 `generation.deleteMany`,
    //      而 `Generation.projectId` 是非空列(`schema.prisma`),所以每一件素材都属于某个
    //      campaign,这条路对每一件都成立;
    //   ② 账户删除那条人工路(本页上方已有)。
    // 两条都必须在这一条 bullet 里点得到名字,不然这一页对「永久删除」这件事是沉默的。
    const bullet = libraryAssetBullet();
    // 钉整句片语,不钉光秃秃的 "campaign" —— 这一条 bullet 前面本来就写着「campaign canvas」,
    // 单个词的断言删掉整句新话也照样绿(判官 #1252 P2-3)。
    expect(bullet).toMatch(/deleting the campaign the asset was made in, which permanently deletes the records held in it/i);
    expect(bullet).toContain("account deletion");
    // 不许把回收站本身写成永久删除。
    expect(bullet).toMatch(/nothing on this route removes the record itself/i);
  });

  it("FRONT-A12 · 一个保留天数都不承诺", () => {
    const bullet = libraryAssetBullet();
    expect(bullet).not.toMatch(/\b\d+\s*(day|days|week|weeks|month|months)\b/i);
  });
});

describe("FRONT-A12 · 详情面删除确认框的指路在每一格都成立", () => {
  it("FRONT-A12 · 确认框把商家先带回 Generation history,不直接说 open More filters", () => {
    const code = stripComments(read(DETAIL_PANEL));
    const match = code.match(/description:\s*"([^"]*Trash[^"]*)"/);
    expect(match, "DetailPanel 里找不到 Move to trash 的确认框说明").not.toBeNull();
    const description = match![1];
    expect(description.toLowerCase()).not.toContain("cannot be undone");
    expect(description).toContain("Generation history");
    expect(description.indexOf("Generation history")).toBeLessThan(description.indexOf("More filters"));
  });
});
