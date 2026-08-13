import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  shotsNeedingMintedFirstFrame,
  shotsStuckWithoutInheritedFrame,
  parseStoryboardCardPayload,
  MAX_STORYBOARD_SHOTS,
} from "../storyboard-card";
import { MAX_STORYBOARD_SHOTS as MAX_STORYBOARD_SHOTS_OTTO } from "@fikirtive/otto";

describe("MAX_STORYBOARD_SHOTS (client-safe copy)", () => {
  // 本地纯值副本存在,只为让 "use client" 的 StoryboardCard 不必 import @fikirtive/otto
  // (那会把 skills→prisma→pg 拖进浏览器 bundle,导致 build 失败)。这条断言在 node 侧
  // 跑,import otto 安全 —— 一旦权威值改动而副本没跟,测试立刻红,漂移不可能。
  it("等于 @fikirtive/otto 的权威值", () => {
    expect(MAX_STORYBOARD_SHOTS).toBe(MAX_STORYBOARD_SHOTS_OTTO);
  });
});

describe("parseStoryboardCardPayload", () => {
  it("empty / undefined payload → 空标题 + 空 shots", () => {
    // #782:多了一格 continuity —— 缺省一律 false(老卡没有这个键,行为与从前逐字一致)。
    expect(parseStoryboardCardPayload(undefined)).toEqual({ storyboardTitle: "", continuity: false, shots: [] });
    expect(parseStoryboardCardPayload(null)).toEqual({ storyboardTitle: "", continuity: false, shots: [] });
    expect(parseStoryboardCardPayload({})).toEqual({ storyboardTitle: "", continuity: false, shots: [] });
  });

  it("shots 不是数组 → shots 归空,标题仍解析", () => {
    const r = parseStoryboardCardPayload({ storyboardTitle: "T", shots: "nope" });
    expect(r).toEqual({ storyboardTitle: "T", continuity: false, shots: [] });
  });

  it("合法 payload → 映射 title + 双 prompt + shotId,按 index 排序", () => {
    const r = parseStoryboardCardPayload({
      storyboardTitle: "New shoes ad",
      shots: [
        { shotId: "sb", index: 1, title: "Hero", firstFramePrompt: "ff-1", videoPrompt: "v-1" },
        { shotId: "sa", index: 0, firstFramePrompt: "ff-0", videoPrompt: "v-0" },
      ],
    });
    expect(r.storyboardTitle).toBe("New shoes ad");
    expect(r.shots.map((s) => s.index)).toEqual([0, 1]);
    expect(r.shots[0]).toEqual({ shotId: "sa", index: 0, firstFramePrompt: "ff-0", videoPrompt: "v-0" });
    expect(r.shots[1].title).toBe("Hero");
    expect(r.shots[1].shotId).toBe("sb");
  });

  it("缺失 shotId 的遗留 payload → 回落到 String(index)", () => {
    const r = parseStoryboardCardPayload({
      storyboardTitle: "X",
      shots: [{ index: 0, firstFramePrompt: "a", videoPrompt: "b" }, { index: 1, firstFramePrompt: "c", videoPrompt: "d" }],
    });
    expect(r.shots.map((s) => s.shotId)).toEqual(["0", "1"]);
  });

  it("entityIds 是字符串数组时透传,否则省略", () => {
    const r = parseStoryboardCardPayload({
      storyboardTitle: "X",
      shots: [
        { shotId: "s0", index: 0, firstFramePrompt: "a", videoPrompt: "b", entityIds: ["ent_1"] },
        { shotId: "s1", index: 1, firstFramePrompt: "c", videoPrompt: "d", entityIds: "nope" },
      ],
    });
    expect(r.shots[0].entityIds).toEqual(["ent_1"]);
    expect(r.shots[1].entityIds).toBeUndefined();
  });

  it("缺失 prompt 字段 → 兜底成空串(不抛)", () => {
    const r = parseStoryboardCardPayload({ storyboardTitle: "X", shots: [{ index: 0 }] });
    expect(r.shots[0].firstFramePrompt).toBe("");
    expect(r.shots[0].videoPrompt).toBe("");
  });

  it("index 缺失 → 回落到数组位置", () => {
    const r = parseStoryboardCardPayload({
      storyboardTitle: "X",
      shots: [{ firstFramePrompt: "a", videoPrompt: "b" }, { firstFramePrompt: "c", videoPrompt: "d" }],
    });
    expect(r.shots.map((s) => s.index)).toEqual([0, 1]);
  });

  it("有 firstFrameGenerationId 时透传(F4 会用)", () => {
    const r = parseStoryboardCardPayload({
      storyboardTitle: "X",
      shots: [{ index: 0, firstFramePrompt: "a", videoPrompt: "b", firstFrameGenerationId: "gen_123" }],
    });
    expect(r.shots[0].firstFrameGenerationId).toBe("gen_123");
  });

  it("firstFrameCardId 透传(F4 用)", () => {
    const r = parseStoryboardCardPayload({
      storyboardTitle: "X",
      shots: [{ shotId: "s0", index: 0, firstFramePrompt: "a", videoPrompt: "b", firstFrameCardId: "child-1" }],
    });
    expect(r.shots[0].firstFrameCardId).toBe("child-1");
  });

  it("durationSeconds 透传(number guard),videoCardId/videoGenerationId 透传(G 用)", () => {
    const r = parseStoryboardCardPayload({
      storyboardTitle: "X",
      shots: [{ shotId: "s0", index: 0, firstFramePrompt: "a", videoPrompt: "b", durationSeconds: 10, videoCardId: "vc-1", videoGenerationId: "vg-1" }],
    });
    expect(r.shots[0].durationSeconds).toBe(10);
    expect(r.shots[0].videoCardId).toBe("vc-1");
    expect(r.shots[0].videoGenerationId).toBe("vg-1");
  });

  it("durationSeconds 非 number → 省略(defensive typeof)", () => {
    const r = parseStoryboardCardPayload({
      storyboardTitle: "X",
      shots: [{ shotId: "s0", index: 0, firstFramePrompt: "a", videoPrompt: "b", durationSeconds: "5", videoCardId: 42 }],
    });
    expect(r.shots[0].durationSeconds).toBeUndefined();
    expect("durationSeconds" in r.shots[0]).toBe(false);
    expect(r.shots[0].videoCardId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// #782 接续:卡面读到的开关,以及「闸① 会为哪些镜头花钱」那条共享规则
// ---------------------------------------------------------------------------

describe("#782 continuity 解析", () => {
  it("只有明写 true 才算开 —— 老卡与垃圾值一律关", () => {
    expect(parseStoryboardCardPayload({ continuity: true }).continuity).toBe(true);
    expect(parseStoryboardCardPayload({ continuity: false }).continuity).toBe(false);
    expect(parseStoryboardCardPayload({ continuity: "yes" }).continuity).toBe(false);
    expect(parseStoryboardCardPayload({}).continuity).toBe(false);
  });
});

describe("#782 shotsNeedingMintedFirstFrame —— 卡面与服务端共读的同一条规则", () => {
  const shots = [
    { index: 1, shotId: "s1" },
    { index: 0, shotId: "s0" },
    { index: 2, shotId: "s2", firstFrameGenerationId: "have" },
  ];

  it("接续关:每个缺帧的镜头都要出一张(老行为)", () => {
    expect(shotsNeedingMintedFirstFrame(shots, false).map((s) => s.shotId)).toEqual(["s0", "s1"]);
  });

  it("接续开:只有第一镜要出图,其余等上一镜交棒(真省钱)", () => {
    expect(shotsNeedingMintedFirstFrame(shots, true).map((s) => s.shotId)).toEqual(["s0"]);
  });

  it("接续开且第一镜已有帧 → 一张都不用出", () => {
    const withFirst = [{ index: 0, shotId: "s0", firstFrameGenerationId: "have" }, { index: 1, shotId: "s1" }];
    expect(shotsNeedingMintedFirstFrame(withFirst, true)).toEqual([]);
  });

  it("按 index 判「第一镜」,不按数组顺序(重排后仍成立)", () => {
    const shuffled = [{ index: 2, shotId: "s2" }, { index: 0, shotId: "s0" }, { index: 1, shotId: "s1" }];
    expect(shotsNeedingMintedFirstFrame(shuffled, true).map((s) => s.shotId)).toEqual(["s0"]);
  });

  it("空分镜 → 空集合(不抛)", () => {
    expect(shotsNeedingMintedFirstFrame([], true)).toEqual([]);
    expect(shotsNeedingMintedFirstFrame([], false)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// #782 r2b(判官 r1 P1 之一)—— 末帧缺失时的诚实恢复入口
//
// 上一镜真的出完片(videoGenerationId 已写回)、闸③ 已经在那次 sync 里试过接力,而这一镜
// 依旧没有首帧、也没有正在铸的首帧子卡 → 卡死,不是「还在等」。区分只看这一条铁事实,
// 不猜测、不设超时。卡死的镜头必须并入 shotsNeedingMintedFirstFrame,否则 Generate all 数
// 不到它、也没有单镜按钮 —— 界面上连恢复入口都没有。
// ---------------------------------------------------------------------------

describe("#782 r2b shotsStuckWithoutInheritedFrame —— 卡死 vs 还在等", () => {
  it("上一镜片子已出完、这一镜仍无帧无子卡 → 卡死", () => {
    const shots = [
      { index: 0, shotId: "s0", firstFrameGenerationId: "ffgen0", videoGenerationId: "vidgen0" },
      { index: 1, shotId: "s1" }, // 供应商键猜错 / worker 没存末帧 / 下载失败,均是这个形状
      { index: 2, shotId: "s2" },
    ];
    // s1 卡死(s0 的片子已出完);s2 不卡死(s1 的片子还没出完,是真的在等)。
    expect(shotsStuckWithoutInheritedFrame(shots, true).map((s) => s.shotId)).toEqual(["s1"]);
  });

  it("上一镜片子还没出完 → 是「还在等」,不是卡死", () => {
    const shots = [
      { index: 0, shotId: "s0", firstFrameGenerationId: "ffgen0" }, // 无 videoGenerationId = 片子未出完
      { index: 1, shotId: "s1" },
    ];
    expect(shotsStuckWithoutInheritedFrame(shots, true)).toEqual([]);
  });

  it("这一镜已经有首帧子卡在铸(framePending)→ 不算卡死", () => {
    const shots = [
      { index: 0, shotId: "s0", firstFrameGenerationId: "ffgen0", videoGenerationId: "vidgen0" },
      { index: 1, shotId: "s1", firstFrameCardId: "child-1" }, // 正在铸/在跑
    ];
    expect(shotsStuckWithoutInheritedFrame(shots, true)).toEqual([]);
  });

  it("这一镜已经有首帧 → 不算卡死(已经接上了)", () => {
    const shots = [
      { index: 0, shotId: "s0", firstFrameGenerationId: "ffgen0", videoGenerationId: "vidgen0" },
      { index: 1, shotId: "s1", firstFrameGenerationId: "inherited-or-own" },
    ];
    expect(shotsStuckWithoutInheritedFrame(shots, true)).toEqual([]);
  });

  it("接续关 → 恒空集合(这条规则只对接续模式有意义)", () => {
    const shots = [
      { index: 0, shotId: "s0", firstFrameGenerationId: "ffgen0", videoGenerationId: "vidgen0" },
      { index: 1, shotId: "s1" },
    ];
    expect(shotsStuckWithoutInheritedFrame(shots, false)).toEqual([]);
  });

  it("按 index 判邻居,不按数组顺序(重排后仍成立)", () => {
    const shuffled = [
      { index: 1, shotId: "s1" },
      { index: 0, shotId: "s0", firstFrameGenerationId: "ffgen0", videoGenerationId: "vidgen0" },
    ];
    expect(shotsStuckWithoutInheritedFrame(shuffled, true).map((s) => s.shotId)).toEqual(["s1"]);
  });
});

describe("#782 r2b shotsNeedingMintedFirstFrame 并入卡死镜头 —— 恢复入口不是死路", () => {
  it("卡死的镜头并入需要铸首帧的集合(计入 Generate all,与第一镜一起)", () => {
    const shots = [
      { index: 0, shotId: "s0", firstFrameGenerationId: "ffgen0", videoGenerationId: "vidgen0" },
      { index: 1, shotId: "s1" }, // 卡死
      { index: 2, shotId: "s2" }, // 还在等 s1(s1 还没出片)
    ];
    // 第一镜已有帧 → 不需要铸;s1 卡死 → 需要;s2 真的在等 → 不需要(不是「缺帧」)。
    expect(shotsNeedingMintedFirstFrame(shots, true).map((s) => s.shotId)).toEqual(["s1"]);
  });

  it("第一镜也缺帧 + 中间一镜卡死 → 两者都进集合,按 index 排序", () => {
    const shots = [
      { index: 0, shotId: "s0" }, // 第一镜也缺帧
      { index: 1, shotId: "s1", firstFrameGenerationId: "own", videoGenerationId: "vidgen1" },
      { index: 2, shotId: "s2" }, // 卡死(s1 的片子已出完)
    ];
    expect(shotsNeedingMintedFirstFrame(shots, true).map((s) => s.shotId)).toEqual(["s0", "s2"]);
  });

  it("没有卡死镜头时行为逐字不变(不引入回归)", () => {
    const shots = [
      { index: 1, shotId: "s1" },
      { index: 0, shotId: "s0" },
      { index: 2, shotId: "s2", firstFrameGenerationId: "have" },
    ];
    expect(shotsNeedingMintedFirstFrame(shots, true).map((s) => s.shotId)).toEqual(["s0"]);
  });
});

// ---------------------------------------------------------------------------
// #782 r2b(判官 r1 P1 之二)—— 卡面文案钉死:连续性不是绝对承诺,重出提示下游不变
//
// 老文案「Each shot picks up exactly where the one before it ends」是一句绝对承诺,而
// 代码的真实行为(storyboard-gate1-actions.ts 闸③)是「只填空,永不覆盖」——重出更早的
// 镜头不会更新已经存在的下游首帧。这里直接读源码钉死新文案,不靠猜测组件渲染出什么。
// ---------------------------------------------------------------------------

describe("#782 r2b 卡面文案钉死", () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const CARD_SOURCE = readFileSync(resolve(HERE, "../../components/otto/StoryboardCard.tsx"), "utf8");

  it("连续性说明不再许这句绝对承诺——「picks up exactly where the one before it ends」", () => {
    expect(CARD_SOURCE).not.toContain("picks up exactly where the one before it ends");
  });

  it("连续性说明改说实话:接续只在首次生成时发生,重出更早的镜头不会动已有首帧的下游镜头", () => {
    expect(CARD_SOURCE).toContain("As each shot is first made, it picks up from the one before it");
    expect(CARD_SOURCE).toContain("Re-making an earlier");
    expect(CARD_SOURCE).toContain("won&rsquo;t change a later shot&rsquo;s first frame once it already has one.");
  });

  it("重出视频的确认框加了一句下游不变的说明", () => {
    expect(CARD_SOURCE).toContain("This won&rsquo;t change the first frame of any shot that already has one.");
  });
});
