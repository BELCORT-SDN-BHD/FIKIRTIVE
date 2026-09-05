/**
 * FRONT-A12 围栏 —— 「没拿到回答」那一句话,全仓只许有一个作者。
 *
 * 病根(判官 #1197 P2-3)。`Couldn't save that — please try again.` 在主干上已经是**八份**
 * 互相抄写的字面量:画布、排程卡、记忆/排程/品牌三处服务器动作、排程服务层。抄件不会一起
 * 改 —— 有人润一次色,商家就在同一种失败下读到两种话;而这句话正是 FRONT-A12 后半句
 * (「任何写入失败都有错误反馈,不出现『假成功』」)靠它说出口的那一句。7.3 要的单一源
 * 从前不存在,#1197 选了「再抄一份并写注释」,判官把它记成待办。这份文件就是那件待办的
 * 机器执行:话住在 `lib/save-failed-copy.ts`,别处只许 import。
 *
 * 为什么用**源码扫描**而不是行为断言。这不是行为缺陷,是增殖缺陷:第 9 份抄件出现的那一天,
 * 每一条行为测试照样全绿(两份字面量逐字相同,渲染出来一模一样),只有扫源码才拦得住。
 * 反过来说,这道围栏什么也不证明关于「这句话在屏幕上出现过」—— 那由
 * `front-a12-canvas-failure-semantics.test.tsx` 的真 DOM 断言管。
 *
 * 红→绿演练(实做,做完还原):把 `lib/memory-actions.ts:77` 的 `SAVE_FAILED` 换回字面量
 * ⇒ 第一条当场红并点名该文件;把 `save-failed-copy.ts` 的导出改名 ⇒ 第二条红。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SAVE_FAILED } from "@/lib/save-failed-copy";

const WEB_ROOT = path.resolve(__dirname, "../..");
/** 这句话的唯一合法住处,相对 `apps/web/`。 */
const SINGLE_SOURCE = "lib/save-failed-copy.ts";
/**
 * 本文件自己不算违例:它必须提到这句话才能扫描它。断言用的是**导入来的**那一份
 * (`SAVE_FAILED`),不是手抄的,所以这里其实不会命中——留这条豁免是为了让人改测试时
 * 不必先猜围栏会不会咬自己。
 */
const SCANNER = "lib/__tests__/save-failed-copy-single-source.test.ts";

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    const isDirectory = entry.isDirectory() || (entry.isSymbolicLink() && fs.statSync(full).isDirectory());
    if (isDirectory) return entry.name === "node_modules" || entry.name === ".next" ? [] : walk(full);
    return full.endsWith(".ts") || full.endsWith(".tsx") ? [full] : [];
  });
}

/**
 * 覆盖边界(判官 #1219 P2-3):扫的是 `apps/web/` 下这四棵树。`design-system/` 在名单里,
 * 所以设计系统里的组件也逃不掉(`components/otto/panel` 那条 symlink 只罩住其中一个子树,
 * 单靠它扫不到别的 pattern)。**不在**名单里的是 `apps/web/e2e/` 与仓库里的 `packages/`——
 * 那两处今天一份抄件也没有(全仓 grep 该字面量只剩 `lib/save-failed-copy.ts` 一处定义),
 * 真要在那里写第 9 份,得先把目录加进来。
 */
function sourceFiles(): string[] {
  const files = ["app", "components", "design-system", "lib"].flatMap((dir) => walk(path.join(WEB_ROOT, dir)));
  // `components/otto/panel` 是指向 `design-system/patterns/otto-panel/` 的 symlink,两棵树
  // 会把同一份文件各走一遍;去重只是为了报错时不重复点名同一个文件。
  return [...new Set(files.map((file) => fs.realpathSync(file)))];
}

describe("FRONT-A12 —— 「没拿到回答」那一句只有一个作者", () => {
  it("FRONT-A12 全仓只有单一源写着这句话的字面量,别处一律 import", () => {
    const offenders = sourceFiles()
      .filter((file) => fs.readFileSync(file, "utf8").includes(SAVE_FAILED))
      .map((file) => path.relative(WEB_ROOT, file))
      .filter((rel) => rel !== SINGLE_SOURCE && rel !== SCANNER)
      .sort();

    expect(
      offenders,
      `又抄了一份「${SAVE_FAILED}」——改成 import { SAVE_FAILED } from "@/lib/save-failed-copy"`,
    ).toEqual([]);
  });

  it("FRONT-A12 单一源自己还在,而且导出的就是那句话", () => {
    const src = fs.readFileSync(path.join(WEB_ROOT, SINGLE_SOURCE), "utf8");
    expect(src, "单一源不再写着这句话——围栏会变成一条恒绿的空断言").toContain(SAVE_FAILED);
    expect(SAVE_FAILED).toBe("Couldn't save that — please try again.");
  });

  it("FRONT-A12 画布、排程卡与三处服务器动作说的都是同一份,不是各自的抄件", () => {
    // 点名的这五个文件是判官清点出来的那八处抄件的家。任一个改回字面量,第一条会红;
    // 任一个不再引用这份单一源(比如换成自造的第二个常量),这一条会红。
    for (const rel of [
      "components/canvas/FlowCanvas.tsx",
      "components/otto/OttoSchedule.tsx",
      "lib/memory-actions.ts",
      "lib/schedule-actions.ts",
      "lib/brand-record-actions.ts",
      "lib/schedule-service.ts",
    ]) {
      expect(
        fs.readFileSync(path.join(WEB_ROOT, rel), "utf8"),
        `${rel} 不再从单一源取这句话`,
      ).toContain("SAVE_FAILED");
    }
  });
});
