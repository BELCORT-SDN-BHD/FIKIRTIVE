/**
 * ingest 派工的**单一权威**围栏(家规 §7.3;R3-F25)。
 *
 * ingest 是写 `Asset.width/height/durationS` 的那一步,而素材理解的扫描器只捞元数据齐的行
 * (`METADATA_READY_FOR_UNDERSTANDING`)。所以「谁把 ingest 派出去」就是「这件素材什么时候
 * 被理解、什么时候按 MONEY-A9 扣那 0.1 credit、什么时候出得了 #1464 那一行回执」。
 *
 * R3-F25 的根因不是画布那条入口忘了做什么特别的事,而是**那段派工逻辑当时只写在一个函数
 * 体里**,于是第二条上传入口抄行、没抄派工,谁都看不出来。这个文件把它钉成一条可机检的规矩:
 *
 *   ① 全站只有**一个**地方 `send(INGEST_QUEUE, …)` —— `lib/ingest-dispatch.ts`;
 *   ② 每一处落 `source: "UPLOAD"` 素材的写点,都必须在下面这张登记表里签过字:
 *      要么当场调 `dispatchIngest`,要么写明它为什么仍旧只靠补投扫描器。
 *
 * 新长出一条上传入口而两条都没做到,这里当场红 —— 那正是 R3-F25 当年没有被任何东西拦住的
 * 那一步。写点**集合**本身另有一道围栏(`understanding-disclosure.test.ts` 的 WRITE_POINT_FILES),
 * 这里只管「写点与派工的关系」。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const LIB = path.resolve(__dirname, "..");

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "__tests__" || e.name === "node_modules") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(e.name)) out.push(full);
    }
  };
  walk(LIB);
  return out;
}

function codeOf(file: string): string {
  return fs.readFileSync(file, "utf8");
}

/** 一个具名函数的源码片段 —— 从它的签名起,到下一个顶层 `function` / `export` 为止。
 *  围栏语义:证的是「这个函数体里提不提这个名字」,不是它的形状。 */
function functionSourceOf(file: string, name: string): string {
  const code = codeOf(path.join(LIB, file));
  const sig = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\b`);
  const m = sig.exec(code);
  expect(m, `${file} 里找不到函数 ${name} —— 写点改名了,登记表要跟着改`).not.toBeNull();
  const from = m!.index;
  const rest = code.slice(from + m![0].length);
  const next = rest.search(/\n(?:export |\/\*\*\n \* |function |class )/);
  return next === -1 ? rest : rest.slice(0, next);
}

/**
 * 落 `source: "UPLOAD"` 素材的写点 → 它与 ingest 派工的关系。
 *
 * `immediate` = 落行之后当场调 `dispatchIngest`,理解与扣费按秒发生。
 * `sweeper-only` = 至今仍靠 `redispatchLostIngest` 的 15 分钟–24 小时补投窗;**必须写明原因**。
 *   这两条不是设计,是与 R3-F25 同一个根的存量缺口(`uploadReference` 是第三条,已随本票修好)。
 *   登记在 `docs/specs/money-engine.md` §5 2026-09-18 行,待 Founder 裁 fix-now 或排队 ——
 *   这里把它写成一条会说话的围栏,而不是让它继续没人知道。
 */
const WRITE_POINTS: ReadonlyArray<{
  file: string;
  fn: string;
  dispatch: "immediate" | "sweeper-only";
  why: string;
}> = [
  {
    file: "upload-actions.ts",
    fn: "finalizeCandidateUploadsInFrame",
    dispatch: "immediate",
    why: "直传落盘的唯一权威(Library 多图、Otto 附件、模板、起步页、Otto 的 URL 导入都走它)",
  },
  {
    file: "actions.ts",
    fn: "uploadReference",
    dispatch: "immediate",
    why: "画布拖放上传 —— R3-F25,Founder 2026-09-18 裁决改成当场入队",
  },
  {
    file: "actions.ts",
    fn: "createEntity",
    dispatch: "sweeper-only",
    why: "Library「新建元素」的参考图 —— 与 R3-F25 同根的存量缺口,本票未动,登记待裁",
  },
  {
    file: "asset-actions.ts",
    fn: "saveCroppedGeneration",
    dispatch: "sweeper-only",
    why: "素材详情的裁剪保存 —— 与 R3-F25 同根的存量缺口,本票未动,登记待裁",
  },
];

describe("ingest 派工的单一权威(R3-F25)", () => {
  it("全站只有一个地方把活送进 ingest 队列", () => {
    const senders = sourceFiles()
      .filter((f) => /\bINGEST_QUEUE\b/.test(codeOf(f)))
      .map((f) => path.relative(LIB, f))
      .sort();
    expect(senders, "多一处 INGEST_QUEUE 就是多一套派工与失败处置 —— 家规 §7.3").toEqual([
      "ingest-dispatch.ts",
    ]);
  });

  it("每一处 UPLOAD 写点都在登记表里,且表里写的与源码一致", () => {
    // 写点所在的文件集合;多一个文件开始落 UPLOAD 素材,登记表就得有人签字。
    const writing = sourceFiles()
      .filter((f) => /source:\s*"UPLOAD"(?:\s+as const)?\s*,/.test(codeOf(f)))
      .map((f) => path.relative(LIB, f))
      .sort();
    expect(writing).toEqual([...new Set(WRITE_POINTS.map((w) => w.file))].sort());

    for (const w of WRITE_POINTS) {
      const src = functionSourceOf(w.file, w.fn);
      const calls = /\bdispatchIngest\s*\(/.test(src);
      expect(calls, `${w.file}#${w.fn} 登记为 ${w.dispatch}(${w.why}),源码对不上`).toBe(
        w.dispatch === "immediate",
      );
      expect(w.why.length, `${w.file}#${w.fn} 没写原因`).toBeGreaterThan(0);
    }
  });

  it("`dispatchIngest` 从不抛 —— 队列挂了也不能让一次成功的上传对商家说失败", () => {
    const src = codeOf(path.join(LIB, "ingest-dispatch.ts"));
    expect(src).toMatch(/catch\s*\(e\)/);
    expect(src, "派工失败必须报警,不能只留一行没人看的日志(C1b ③)").toContain(
      "reportUndispatchedIngest",
    );
  });
});
