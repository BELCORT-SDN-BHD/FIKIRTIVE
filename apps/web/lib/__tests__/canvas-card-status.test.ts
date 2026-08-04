// @vitest-environment jsdom
/**
 * #602 T3 — 状态代数(spec #599 D4)。
 *
 * 一句话:画布卡的状态是一个**有限、互斥、单向前进**的集合,谁读都读同一份推导,兜底一律
 * 「未知」。这份测试守四条,每条对应一类真实缺陷:
 *
 *   ① 推导是**全函数**,穷举驱动 —— 每一组输入都落在唯一一张卡面上,而且落不到的那一格是
 *      `unknown`,不是 `generating`。永久转圈(F21)就是「不认识的词 → 当成正在生成」造出来的。
 *   ② 六态卡面各说各的话 —— 排队 / 进行中 / 成功 / 失败 / 已取消 / 未知,用的是真的 ImageNode
 *      与 VideoNode(板子挂的就是它们),断言商家读到的字。
 *   ③ 单向前进 —— 写入者各自的 WHERE 谓词必须是这条序关系的子集,规则才是**库里**的规则,
 *      而不是注释里的规则。
 *   ④ 一份词表 —— 行的词表和迁移里的取值检查逐字对齐,面的词表和渲染分支逐条对齐。
 *
 * 全程零花费:纯函数 + 两个卡片组件,没有任何服务端动作被调用。
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../canvas-actions", () => ({ resolveCanvasNode: vi.fn(), createCanvasNode: vi.fn() }));
vi.mock("../gen-actions", () => ({ getGenJob: vi.fn(), startCanvasGen: vi.fn() }));
vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...actual,
    Handle: () => null,
    NodeResizer: () => null,
    NodeToolbar: ({ isVisible, children }: { isVisible?: boolean; children?: unknown }) =>
      isVisible === false ? null : createElement("div", null, children as ReactElement),
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");

const {
  CANVAS_CARD_FACES,
  CANVAS_CARD_ROW_STATUSES,
  IN_FLIGHT_CARD_FACES,
  OVERWRITABLE_CARD_STATUSES,
  TERMINAL_CARD_STATUSES,
  canvasCardFace,
  canvasCardRowAdvances,
  isCanvasCardFace,
  isCanvasCardRowStatus,
  isInFlightCardFace,
  isTerminalCardStatus,
} = await import("@/lib/canvas-card-status");
const { ImageNode } = await import("@/components/canvas/nodes/ImageNode");
const { VideoNode } = await import("@/components/canvas/nodes/VideoNode");
const { isInFlightPaidGen } = await import("@/components/canvas/useCanvasGen");

/** Every GenStatus the schema defines, plus the two "no job to ask" cases a reader really meets. */
const JOB_STATUSES = ["QUEUED", "GENERATING", "DONE", "FAILED", "CANCELLED", null, undefined] as const;
/** Row words the constraint allows, plus a word from outside it (a cleansed legacy row's shape). */
const ROW_INPUTS = [...CANVAS_CARD_ROW_STATUSES, "a-word-nobody-planned-for"] as const;

describe("① 推导是全函数:每一组输入都落在唯一一张合法卡面上", () => {
  it("never answers with a word outside the face set, whatever it is given", () => {
    for (const rowStatus of ROW_INPUTS) {
      for (const jobStatus of JOB_STATUSES) {
        for (const generationId of [null, "gen_1"]) {
          for (const url of [null, "https://cdn.example/a.png"]) {
            const face = canvasCardFace({ rowStatus, jobStatus, generationId, url });
            expect(isCanvasCardFace(face), `${rowStatus}/${jobStatus}/${generationId}/${url} → ${face}`).toBe(true);
          }
        }
      }
    }
  });

  it("答案由「谁最有资格说话」决定:图 > 已绑产物 > 任务 > 行 > 未知", () => {
    // 1. 图片已经在屏幕上,谁也盖不过它。
    expect(canvasCardFace({ rowStatus: "pending", jobStatus: "GENERATING", url: "https://cdn/a.png" })).toBe("done");
    // 2. 绑了付费产物但图取不到 —— 活儿在,这张卡放不出来,绝不是「还在做」。
    expect(canvasCardFace({ rowStatus: "done", jobStatus: "DONE", generationId: "gen_1", url: null })).toBe("missing");
    // 3. 任务比行新:行还没被结算改过,任务已经知道结果了。
    expect(canvasCardFace({ rowStatus: "pending", jobStatus: "CANCELLED" })).toBe("cancelled");
    expect(canvasCardFace({ rowStatus: "done", jobStatus: "QUEUED" })).toBe("queued");
    // 4. 没有任务可问(手动从库里拖上来的图),行自己说了算。
    expect(canvasCardFace({ rowStatus: "done" })).toBe("done");
    expect(canvasCardFace({ rowStatus: "timeout" })).toBe("timeout");
  });

  it("兜底是「未知」,永远不是「生成中」—— 这是永久转圈的病根", () => {
    // 一个谁都不认得的词。
    expect(canvasCardFace({ rowStatus: "a-word-nobody-planned-for" })).toBe("unknown");
    // 迁移清洗过的历史行。
    expect(canvasCardFace({ rowStatus: "unknown" })).toBe("unknown");
    // 说自己「正在被做」,可是没有任何任务能证实 —— 最纯粹的一种永久转圈。
    expect(canvasCardFace({ rowStatus: "pending", jobStatus: null })).toBe("unknown");
    // 每一条兜底路径都不许说 generating。
    for (const rowStatus of ROW_INPUTS) {
      expect(canvasCardFace({ rowStatus, jobStatus: null })).not.toBe("generating");
    }
  });

  it("排队与进行中是两句不同的话,由任务而不是行来分", () => {
    expect(canvasCardFace({ rowStatus: "pending", jobStatus: "QUEUED" })).toBe("queued");
    expect(canvasCardFace({ rowStatus: "pending", jobStatus: "GENERATING" })).toBe("generating");
  });
});

/** 六态卡面:用真的卡片组件渲染,断言商家读到的字。 */
async function renderFace(component: typeof ImageNode | typeof VideoNode, status: string): Promise<string> {
  let text = "";
  await act(async () => {
    root!.render(createElement(component, {
      id: "card-1",
      type: "image",
      selected: false,
      data: { status, prompt: "a cup steaming" },
    } as never));
  });
  text = container!.textContent ?? "";
  return text;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("② 六态卡面:排队 / 进行中 / 成功 / 失败 / 已取消 / 未知", () => {
  it.each([
    ["queued", "In the queue…"],
    ["generating", "Generating…"],
    ["failed", "That didn't finish"],
    ["cancelled", "Cancelled"],
    ["unknown", "Status unknown"],
  ])("图片卡在 %s 说的是自己的那句话", async (status, expected) => {
    const text = await renderFace(ImageNode, status);
    expect(text).toContain(expected);
  });

  it("成功态放的是图,不是任何一句状态文案", async () => {
    await act(async () => {
      root!.render(createElement(ImageNode, {
        id: "card-1",
        type: "image",
        selected: false,
        data: { status: "done", url: "https://cdn.example/a.png", prompt: "a cup steaming" },
      } as never));
    });
    expect(container!.querySelector("img")?.getAttribute("src")).toBe("https://cdn.example/a.png");
    expect(container!.textContent ?? "").not.toContain("Generating…");
  });

  it("排队不许说成「正在做」—— 卡片只知道任务被接受了", async () => {
    const text = await renderFace(ImageNode, "queued");
    expect(text).not.toContain("Generating…");
    expect(text).not.toContain("Otto is making this");
  });

  it("已取消不是失败:没有失败措辞,也没有重试按钮", async () => {
    await act(async () => {
      root!.render(createElement(ImageNode, {
        id: "card-1",
        type: "image",
        selected: false,
        // onRefresh 给上了:就算给了,取消态也不许长出「Check again」。
        data: { status: "cancelled", prompt: "a cup steaming", onRefresh: () => {} },
      } as never));
    });
    const text = container!.textContent ?? "";
    expect(text).toContain("Cancelled");
    expect(text).toContain("This generation was cancelled.");
    expect(text).not.toContain("That didn't finish");
    expect(text).not.toContain("Try again");
    expect(text).not.toContain("Check again");
    expect(container!.querySelectorAll("button")).toHaveLength(0);
  });

  it("未知态停转圈,并给一条回得去的路", async () => {
    await act(async () => {
      root!.render(createElement(ImageNode, {
        id: "card-1",
        type: "image",
        selected: false,
        data: { status: "unknown", prompt: "a cup steaming", onRefresh: () => {} },
      } as never));
    });
    const text = container!.textContent ?? "";
    expect(text).toContain("Status unknown");
    expect(text).not.toContain("Generating…");
    expect(text).toContain("Check again");
  });

  it("视频卡认得同一套词", async () => {
    expect(await renderFace(VideoNode, "cancelled")).toContain("Cancelled");
    expect(await renderFace(VideoNode, "queued")).toContain("In the queue…");
    expect(await renderFace(VideoNode, "generating")).toContain("Rendering…");
    expect(await renderFace(VideoNode, "unknown")).toContain("Status unknown");
  });

  it("每一张脸都被渲染器认领:要么在途,要么停下,没有第三种", () => {
    for (const face of CANVAS_CARD_FACES) {
      const claimed = face === "done" || isInFlightCardFace(face) || isTerminalCardStatus(face);
      expect(claimed, `no renderer claims the face "${face}"`).toBe(true);
    }
  });
});

/**
 * 每一个写入者,写成 (它能改的行, 它能写的词) 两张表 —— 直接从生产代码的 WHERE 谓词抄下来。
 * 这份台账是断言的对象:只要有人加一个写入者、或者放宽一条 WHERE,这里就必须跟着改,
 * 「单向前进」才是**库里**的规则,而不是注释里的规则。
 */
const WRITERS = [
  {
    // 只有一种更新:把已经绑上产物的卡改成 done(`data.status = "done"`),
    // 而且 WHERE 明确排除墓碑。建新行不在这张表里 —— 新行没有「从哪来」。
    name: "placeCanvasJobNode(把卡绑到产物上)",
    from: ["pending", "done", "failed", "cancelled", "timeout", "missing", "unknown"],
    to: ["done"],
  },
  {
    name: "resolveCanvasNode(浏览器上报 · #612 迟到写挡板)",
    from: [...OVERWRITABLE_CARD_STATUSES],
    to: ["done", "failed", "cancelled", "timeout", "missing"],
  },
  {
    name: "settleCanvasCardsForGenJob(任务自己的结局)",
    // WHERE: status not 'deleted' —— 结算是唯一读得到任务行的写入者。
    from: ["pending", "done", "failed", "cancelled", "timeout", "missing", "unknown"],
    to: ["done", "failed", "cancelled"],
  },
  {
    name: "tombstoneCanvasNode(商家删卡)",
    from: ["pending", "done", "failed", "cancelled", "timeout", "missing", "unknown"],
    to: ["deleted"],
  },
] as const;

describe("③ 单向前进:没有写入者能把一张卡拉回去", () => {
  it.each(WRITERS.map((w) => [w.name, w] as const))("%s 的每一种可能写法都是前进", (_name, writer) => {
    for (const from of writer.from) {
      for (const to of writer.to) {
        expect(canvasCardRowAdvances(from, to), `${from} → ${to}`).toBe(true);
      }
    }
  });

  it("往回走的两个方向都被序关系判死:停下的不许重新开始,删掉的不许回来", () => {
    // 停下 → 重新在做:这就是迟到的浏览器上报把已结算卡打回「还在做」的那一类。
    for (const settled of ["done", "failed", "cancelled", "missing", "unknown"]) {
      expect(canvasCardRowAdvances(settled, "pending"), `${settled} → pending`).toBe(false);
      expect(canvasCardRowAdvances(settled, "timeout"), `${settled} → timeout`).toBe(false);
    }
    // 墓碑吸收一切:删掉的卡任何写入者都不许复活。
    for (const to of CANVAS_CARD_ROW_STATUSES) {
      expect(canvasCardRowAdvances("deleted", to), `deleted → ${to}`).toBe(to === "deleted");
    }
  });

  it("同一个词可以再写一遍 —— 结算按形状幂等,必须保持如此", () => {
    for (const status of CANVAS_CARD_ROW_STATUSES) {
      expect(canvasCardRowAdvances(status, status)).toBe(true);
    }
  });

  it("浏览器上报改不到任何一张已经结算的卡(这条才是真正的挡板)", () => {
    for (const settled of ["done", "failed", "cancelled", "missing", "unknown", "deleted"]) {
      expect((OVERWRITABLE_CARD_STATUSES as readonly string[]).includes(settled), settled).toBe(false);
    }
    expect([...OVERWRITABLE_CARD_STATUSES]).toEqual(["pending", "timeout"]);
  });

  it("集合外的词一律拒绝,序关系不给它落脚点", () => {
    expect(canvasCardRowAdvances("pending", "generating")).toBe(false);
    expect(canvasCardRowAdvances("ready", "done")).toBe(false);
  });
});

describe("④ 一份词表:代码、迁移与渲染分支逐字对齐", () => {
  it("行的词表与迁移里的取值检查一模一样", () => {
    const migration = readFileSync(
      resolve(REPO_ROOT, "packages/db/prisma/migrations/20260805090000_t3_canvas_node_status_check/migration.sql"),
      "utf8",
    );
    const check = /ADD CONSTRAINT "CanvasNode_status_check" CHECK \(\s*"status" IN \(([^)]*)\)/.exec(migration);
    expect(check, "the migration must still create CanvasNode_status_check").not.toBeNull();
    const inMigration = [...check![1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    expect(inMigration.sort()).toEqual([...CANVAS_CARD_ROW_STATUSES].sort());
  });

  it("清洗只把越集值搬到 unknown,不删行", () => {
    const migration = readFileSync(
      resolve(REPO_ROOT, "packages/db/prisma/migrations/20260805090000_t3_canvas_node_status_check/migration.sql"),
      "utf8",
    );
    expect(migration).toContain(`SET "status" = 'unknown'`);
    expect(migration).not.toMatch(/DELETE\s+FROM|DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE/i);
  });

  it("行的词表与面的词表各自封闭,而且互相知道对方存在", () => {
    // queued/generating 只是脸,没有自己的行;deleted 只是行,没有自己的脸。
    expect([...CANVAS_CARD_FACES].filter((face) => !isCanvasCardRowStatus(face)).sort())
      .toEqual(["generating", "queued"]);
    expect([...CANVAS_CARD_ROW_STATUSES].filter((row) => !isCanvasCardFace(row)).sort())
      .toEqual(["deleted", "pending"]);
  });

  it("只有真的在做才允许动,timeout 之外的停下状态都不再算在途", () => {
    expect([...IN_FLIGHT_CARD_FACES]).toEqual(["queued", "generating"]);
    expect(isInFlightPaidGen({ type: "image", status: "queued", url: null })).toBe(true);
    expect(isInFlightPaidGen({ type: "image", status: "generating", url: null })).toBe(true);
    // timeout 还算:任务可能还在跑,只是这个标签页不看了 —— 删它仍然不退款。
    expect(isInFlightPaidGen({ type: "image", status: "timeout", url: null })).toBe(true);
    for (const settled of ["failed", "cancelled", "missing", "unknown"]) {
      expect(isInFlightPaidGen({ type: "image", status: settled, url: null }), settled).toBe(false);
    }
  });

  it("停下的那几张脸就是 TERMINAL_CARD_STATUSES,unknown 也在里面", () => {
    expect([...TERMINAL_CARD_STATUSES]).toEqual(["failed", "cancelled", "timeout", "missing", "unknown"]);
  });
});
