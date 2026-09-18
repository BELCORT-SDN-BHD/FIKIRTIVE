/**
 * ingest 派工的**单一权威**围栏(家规 §7.3;R3-F25,2026-09-18 复审回修按函数粒度重写)。
 *
 * ingest 是写 `Asset.width/height/durationS` 的那一步,而素材理解的扫描器只捞元数据齐的行
 * (`METADATA_READY_FOR_UNDERSTANDING`)。所以「谁把 ingest 派出去」就是「这件素材什么时候
 * 被理解、什么时候按 MONEY-A9 扣那 0.1 credit、什么时候出得了 #1464 那一行回执」。
 *
 * R3-F25 的根因不是画布那条入口忘了做什么特别的事,而是**那段派工逻辑当时只写在一个函数
 * 体里**,于是第二条上传入口抄行、没抄派工,谁都看不出来。这个文件把它钉成三条可机检的规矩:
 *
 *   ① `apps/web/lib` 里只有**一个**地方 `send(INGEST_QUEUE, …)` —— `lib/ingest-dispatch.ts`;
 *   ② 每一个会落 `source: "UPLOAD"` 素材的**导出动作**(不是「文件」)都在下面这张登记表里
 *      签过字:要么当场调 `dispatchIngest`,要么写明它为什么仍旧只靠补投扫描器;
 *   ③ `dispatchIngest` 从不抛 —— 队列挂了也不能让一次成功的上传对商家说失败。
 *
 * **为什么是函数粒度**(复审 P2,2026-09-18):上一版按**文件**比对,于是在一个已经登记过的
 * 写点文件里新长一支落 UPLOAD 行却不派工的导出函数,这里纹丝不动 —— 复审者加一支
 * `uploadReferenceV2` 当场实证过。现在两侧都从**同一张普查表**读:
 * `helpers/upload-write-census.ts`(原先只写在 `understanding-disclosure.test.ts` 文件体里,
 * 那道围栏一直是按函数对账的,只是这道够不到它)。那张表按语法树推导 `模块#导出名`,并做
 * 跨文件传递闭包,所以像 `createEntity` 这种**经 `ingestFile` 转一手**才落行的也在里面。
 *
 * **不在这里的**:写点普查本身的正确性(块级作用域、别名导入、默认导出、已知边界逐条)
 * 由 `understanding-disclosure.test.ts` 的那一组夹具钉着 —— 同一份实现,一份证一次。
 */
import { describe, it, expect, vi, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  WEB_ROOT,
  parseFile,
  importedActionsOf,
  uploadWritersOf,
  uploadActionKeys,
} from "./helpers/upload-write-census";

const { mockSend, mockCaptureMessage } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockCaptureMessage: vi.fn(),
}));
vi.mock("@/lib/queue", () => ({ getBoss: vi.fn(async () => ({ send: mockSend })) }));
vi.mock("@sentry/node", () => ({ captureMessage: mockCaptureMessage }));

const { dispatchIngest } = await import("@/lib/ingest-dispatch");

/** 这道围栏扫的是 **`apps/web/lib` 这一棵树**,不是全仓 —— 见下面①那条的判词。 */
const LIB = path.resolve(WEB_ROOT, "lib");

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

/** 派工那一处的动作键 —— 与登记表同一套坐标(`模块#导出名`,模块 id 已剥扩展名)。 */
const DISPATCH_ACTION = "lib/ingest-dispatch#dispatchIngest";

/**
 * 落 `source: "UPLOAD"` 素材的**导出动作** → 它与 ingest 派工的关系。
 *
 * `immediate` = 落行之后当场(事务提交之后、回话之前)调 `dispatchIngest`,理解与扣费按秒发生。
 * `sweeper-only` = 至今仍靠 `redispatchLostIngest` 的 15 分钟–24 小时补投窗;**必须写明原因**。
 *   今天这一栏是空的:Founder 2026-09-18 裁「这个设计完全不合理,可以移除」针对的是**这一类**
 *   设计,不是画布那一条入口,所以同根的 `createEntity` 与 `saveCroppedGeneration` 随同一票
 *   一起改成当场入队(家规「修根不修表、关类不补例」)。这一栏留着不是摆设 —— 将来真有一条
 *   入口只能靠补投,它得在这里写下为什么,而不是安静地躺在那里。
 *
 * 键的集合不是手抄的:下面第一条测试拿它与普查表对账,多一支、少一支、改个名都红。
 */
const REGISTER: ReadonlyArray<{
  action: string;
  dispatch: "immediate" | "sweeper-only";
  why: string;
}> = [
  {
    action: "lib/upload-actions#finalizeCandidateUploads",
    dispatch: "immediate",
    why: "直传落盘的唯一权威(Library 多图、Otto 附件、模板、起步页、Otto 的 URL 导入都走它);派工在 finalizeCandidateUploadsInFrame 里,经本模块内转调一手",
  },
  {
    action: "lib/actions#uploadReference",
    dispatch: "immediate",
    why: "画布拖放上传 —— R3-F25,Founder 2026-09-18 裁决改成当场入队",
  },
  {
    action: "lib/actions#createEntity",
    dispatch: "immediate",
    why: "Library「新建元素」的参考图 —— 与 R3-F25 同根,2026-09-18 复审回修一并改成当场入队",
  },
  {
    action: "lib/asset-actions#saveCroppedGeneration",
    dispatch: "immediate",
    why: "素材详情的裁剪保存 —— 与 R3-F25 同根,2026-09-18 复审回修一并改成当场入队",
  },
];

/** `模块#导出名` 的两半。 */
function splitAction(action: string): { moduleId: string; exportName: string } {
  const at = action.lastIndexOf("#");
  return { moduleId: action.slice(0, at), exportName: action.slice(at + 1) };
}

/** 模块 id → 它的源文件(普查里的模块 id 是剥了扩展名的)。 */
function fileOfModule(moduleId: string): string {
  for (const rel of [`${moduleId}.ts`, `${moduleId}.tsx`, `${moduleId}/index.ts`]) {
    if (fs.existsSync(path.join(WEB_ROOT, rel))) return rel;
  }
  throw new Error(`登记表里的 ${moduleId} 找不到源文件 —— 动作改名或搬家了,登记表要跟着改`);
}

/**
 * 这个文件里,哪些**导出**函数够得到 `dispatchIngest`(含本模块内转调一手)。
 *
 * 走的是普查的同一套机器,只换了种子:不从 `source: "UPLOAD"` 写点起,只从「调了那个
 * 跨模块导入的 `dispatchIngest`」起,再按调用关系做本模块内的传递闭包。所以
 * `finalizeCandidateUploads → finalizeCandidateUploadsInFrame → dispatchIngest` 这种
 * 转一手的形状照样算数,而「同一个文件里另一支函数调了」不会被算到这一支头上。
 */
function dispatchReachers(rel: string): Set<string> {
  const sf = parseFile(rel);
  const imported = importedActionsOf(rel, sf, new Set([DISPATCH_ACTION]));
  return new Set(uploadWritersOf(sf, imported, () => false).exportedWriters);
}

describe("ingest 派工的单一权威(R3-F25)", () => {
  it("apps/web/lib 里只有一个地方把活送进 ingest 队列", () => {
    const senders = sourceFiles()
      .filter((f) => /\bINGEST_QUEUE\b/.test(codeOf(f)))
      .map((f) => path.relative(LIB, f))
      .sort();
    // 判词说准(复审 P3):这道闸扫的是 **`apps/web/lib`**,不是全仓。worker 侧清道夫
    // `redispatchLostIngest` 的那一次送单(`apps/worker/src/index.ts` 的 `boss.send(QUEUES.ingest, …)`)
    // 是**有意保留**的第二处 —— 它恰恰是在补救「派工发出去失败了」,不可能由 apps/web 代劳。
    expect(senders, "apps/web 里多一处 INGEST_QUEUE 就是多一套派工与失败处置 —— 家规 §7.3").toEqual([
      "ingest-dispatch.ts",
    ]);
  });

  it("每一个会落 UPLOAD 素材的导出动作都在登记表里(按函数,不按文件)", () => {
    // 普查表是**扫出来的**(`helpers/upload-write-census.ts`,语法树 + 跨文件闭包),登记表是
    // 人签的字。两边逐键相等:既有文件里新长一支落 UPLOAD 行的导出函数,这里当场红 ——
    // 那正是上一版按文件比对时静默放行的那一步(复审 P2 的 `uploadReferenceV2`)。
    expect(uploadActionKeys()).toEqual([...REGISTER.map((r) => r.action)].sort());
  });

  it("登记表里写的与源码一致:immediate 的那几支真的够得到 dispatchIngest", () => {
    const cache = new Map<string, Set<string>>();
    for (const entry of REGISTER) {
      const { moduleId, exportName } = splitAction(entry.action);
      const rel = fileOfModule(moduleId);
      if (!cache.has(rel)) cache.set(rel, dispatchReachers(rel));
      expect(
        cache.get(rel)!.has(exportName),
        `${entry.action} 登记为 ${entry.dispatch}(${entry.why}),源码对不上`,
      ).toBe(entry.dispatch === "immediate");
      expect(entry.why.length, `${entry.action} 没写原因`).toBeGreaterThan(0);
    }
  });
});

describe("`dispatchIngest` 从不抛 —— 队列挂了也不能让一次成功的上传对商家说失败", () => {
  // 上一版这条只 grep 了一个 `catch (e)`。那是在证「源码里有这四个字符」,不是在证行为:
  // 把 catch 里改成 `throw e` 照样全绿,而调用方就会对一次已经落库的上传说「失败了」——
  // 商家于是再传一遍(C1b ③ 的原话)。所以这里换成真跑一遍。
  const dsn = process.env.SENTRY_DSN;
  process.env.SENTRY_DSN = "https://fence@example.invalid/0"; // 没有 DSN 时报警整段短路
  afterAll(() => {
    if (dsn === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = dsn;
  });

  it("一个 id 派不出去:不抛、不拖垮同批其余的、报警只带 id", async () => {
    mockSend.mockReset();
    mockCaptureMessage.mockReset();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSend.mockImplementation(async (_queue: string, payload: { assetId: string }) => {
      if (payload.assetId === "ast_bad") throw new Error("queue down");
      return "job-id";
    });

    await expect(dispatchIngest(["ast_ok1", "ast_bad", "ast_ok2"])).resolves.toBeUndefined();

    // 一个失败不拖垮整批 —— 每个 id 各试各的。
    expect(mockSend.mock.calls.map((c) => (c[1] as { assetId: string }).assetId)).toEqual([
      "ast_ok1",
      "ast_bad",
      "ast_ok2",
    ]);

    // 报警有,而且**只带 id**:没有租户、没有文件名、没有哈希(与死信探针同一条纪律)。
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
    const [message, options] = mockCaptureMessage.mock.calls[0] as [
      string,
      { level: string; tags: Record<string, string>; extra: Record<string, unknown> },
    ];
    expect(message).toContain("1 upload(s)");
    expect(options).toMatchObject({
      level: "error",
      tags: { probe: "ingest-dispatch" },
      extra: { assetIds: "ast_bad", count: 1 },
    });
    expect(Object.keys(options.extra).sort()).toEqual(["assetIds", "count"]);
    errors.mockRestore();
  });

  it("整条队列挂了:调用方照样拿到 resolve,一次报警把这一批都报进去", async () => {
    mockSend.mockReset();
    mockCaptureMessage.mockReset();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSend.mockRejectedValue(new Error("queue down"));

    await expect(dispatchIngest(["ast_a", "ast_b"])).resolves.toBeUndefined();

    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
    expect((mockCaptureMessage.mock.calls[0] as [string, { extra: Record<string, unknown> }])[1].extra)
      .toMatchObject({ assetIds: "ast_a ast_b", count: 2 });
    errors.mockRestore();
  });

  it("一条都没失败就不报警(报警不是日常噪音)", async () => {
    mockSend.mockReset();
    mockCaptureMessage.mockReset();
    mockSend.mockResolvedValue("job-id");

    await expect(dispatchIngest(["ast_a", "ast_b"])).resolves.toBeUndefined();

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });
});
