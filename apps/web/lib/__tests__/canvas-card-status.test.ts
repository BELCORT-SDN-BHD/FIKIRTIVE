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
 *   ⑤ 停下的卡还带着**为什么**(#827)—— 原因是卡自己状态的一部分,取自任务行,所以刷新、
 *      换设备都还在;而且只有 `failed` 那张脸能带原因,别的脸带上就是在说没发生过的事。
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
  canvasCardState,
  canvasCardRowAdvances,
  isCanvasCardFace,
  isCanvasCardRowStatus,
  isInFlightCardFace,
  isTerminalCardStatus,
} = await import("@/lib/canvas-card-status");
const { REFERENCE_IMAGE_PERSON_REJECTED } = await import("@fikirtive/core/gen-failure");
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
    expect(canvasCardFace({ rowStatus: "done", url: "https://cdn/a.png" })).toBe("done");
    expect(canvasCardFace({ rowStatus: "timeout" })).toBe("timeout");
    // …但「行说 done,手上却什么都没有」不是 done,是 missing(#602 r2 复审 P1-3):
    // 渲染器对画不出媒体的脸会回落到转圈,于是这种卡从前永久转圈。
    expect(canvasCardFace({ rowStatus: "done" })).toBe("missing");
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

  it("说自己 done 却什么都没有的卡,说的是「取不到」而不是转圈(#602 r2 复审 P1-3)", async () => {
    // 渲染器从前的兜底是「在途 || 没有图 → 转圈」,于是任何走到这里又没有图的卡都永久转圈:
    // 库里的图取不到了、Otto 放了一张没绑产物的卡,都算。
    const text = await renderFace(ImageNode, "done");

    expect(text).not.toContain("Generating…");
    expect(text).not.toContain("Otto is making this");
    expect(text).toContain("Preview missing");
  });

  it("视频卡同理", async () => {
    const text = await renderFace(VideoNode, "done");
    expect(text).not.toContain("Rendering…");
    expect(text).toContain("Preview missing");
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

describe("③ 单向前进:没有写入者能把一张卡拉回去", () => {
  // 序关系本身在这里定义清楚;**真谓词的驱动**在 packages/db/src/__tests__/canvas-node-status-check.test.ts
  // ——那里拿真库跑真结算,再对落库前后的两个词断言这条序关系(#602 r2 复审 P2:
  // 「把 WHERE 抄一遍」证明不了什么,抄本和代码会漂,而测试读的是抄本)。
  it("往回走的两个方向都被判死:停下的不许重新开始,删掉的不许回来", () => {
    for (const settled of ["done", "failed", "cancelled", "missing", "unknown"]) {
      expect(canvasCardRowAdvances(settled, "pending"), `${settled} → pending`).toBe(false);
      expect(canvasCardRowAdvances(settled, "timeout"), `${settled} → timeout`).toBe(false);
    }
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
    // 这个常量不是复述:resolveCanvasNode 的 WHERE 直接 spread 它,改这里就等于改那道写。
    for (const settled of ["done", "failed", "cancelled", "missing", "unknown", "deleted"]) {
      expect((OVERWRITABLE_CARD_STATUSES as readonly string[]).includes(settled), settled).toBe(false);
    }
    expect([...OVERWRITABLE_CARD_STATUSES]).toEqual(["pending", "timeout"]);
    // …而它允许写的五个词,从这两种行出发全都是前进。
    for (const from of OVERWRITABLE_CARD_STATUSES) {
      for (const to of ["done", "failed", "cancelled", "timeout", "missing"]) {
        expect(canvasCardRowAdvances(from, to), `${from} → ${to}`).toBe(true);
      }
    }
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

describe("⑤ 停下的卡还带着「为什么」(#827)", () => {
  // #765 认出的那句拒绝,是 worker 落在 GenJob.error 上的原话。测试比的是常量本身,不是
  // 抄一遍的字面量 —— 抄本会漂,而商家读到的是代码里的那一份。
  const REFUSAL = REFERENCE_IMAGE_PERSON_REJECTED;

  it("失败的卡把任务行上的原因收进自己的状态", () => {
    expect(canvasCardState({ rowStatus: "pending", jobStatus: "FAILED", jobError: REFUSAL }))
      .toEqual({ face: "failed", failureReason: "referenceImagePerson" });
  });

  it("每一张卡都有一个原因,普通失败的那个原因叫「说不出」", () => {
    // 不是缺字段,是集合里的一个成员 —— 所以没有哪个读者需要一条「万一没有呢」的分支。
    expect(canvasCardState({ rowStatus: "pending", jobStatus: "FAILED", jobError: "provider said no" }))
      .toEqual({ face: "failed", failureReason: "unexplained" });
    // 历史卡:#827 之前结算的任务,error 栏是运维串或者干脆是空的。
    expect(canvasCardState({ rowStatus: "failed" }))
      .toEqual({ face: "failed", failureReason: "unexplained" });
    expect(canvasCardState({ rowStatus: "pending", jobStatus: "FAILED", jobError: null }))
      .toEqual({ face: "failed", failureReason: "unexplained" });
  });

  it("只有 failed 那张脸能带原因 —— 别的脸带上就是在说没发生过的事", () => {
    // 就算把同一句话塞给每一种输入:取消是商家自己的决定,timeout 根本还没结束,missing 是
    // 活儿在但这张卡放不出来,unknown 是「说不清这张卡怎么了」。它们都不是这次拒绝。
    for (const [input, face] of [
      [{ rowStatus: "pending", jobStatus: "CANCELLED" }, "cancelled"],
      [{ rowStatus: "timeout" }, "timeout"],
      [{ rowStatus: "done", jobStatus: "DONE", generationId: "gen_1" }, "missing"],
      [{ rowStatus: "a-word-nobody-planned-for" }, "unknown"],
      [{ rowStatus: "pending", jobStatus: "GENERATING" }, "generating"],
      [{ rowStatus: "pending", jobStatus: "QUEUED" }, "queued"],
      [{ rowStatus: "pending", jobStatus: "GENERATING", url: "https://cdn/a.png" }, "done"],
    ] as const) {
      expect(canvasCardState({ ...input, jobError: REFUSAL }), face)
        .toEqual({ face, failureReason: "unexplained" });
    }
  });

  it("脸的推导一个字没动:两个函数对同一组输入永远同一张脸", () => {
    for (const rowStatus of ROW_INPUTS) {
      for (const jobStatus of JOB_STATUSES) {
        for (const url of [null, "https://cdn.example/a.png"]) {
          const input = { rowStatus, jobStatus, url };
          expect(canvasCardState({ ...input, jobError: REFUSAL }).face).toBe(canvasCardFace(input));
        }
      }
    }
  });

  it("运维串永远不会变成商家看到的原因(GenJob.error 同时是运维栏)", () => {
    for (const ops of [
      "conditioning refs unreachable (0/1) — refusing to spend",
      "stale GENERATING reaped — worker hung or crashed; refunded",
      `${REFUSAL} …and here is the raw engine reply`,
    ]) {
      expect(canvasCardState({ rowStatus: "pending", jobStatus: "FAILED", jobError: ops }).failureReason)
        .toBe("unexplained");
    }
  });
});
