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

  it("#782 r3 闸③ 判词 inheritBlockedByVideoCardId 透传(string guard)", () => {
    const r = parseStoryboardCardPayload({
      storyboardTitle: "X",
      shots: [
        { shotId: "s0", index: 0, firstFramePrompt: "a", videoPrompt: "b", inheritBlockedByVideoCardId: "vchild-0" },
        { shotId: "s1", index: 1, firstFramePrompt: "c", videoPrompt: "d", inheritBlockedByVideoCardId: 42 },
      ],
    });
    expect(r.shots[0].inheritBlockedByVideoCardId).toBe("vchild-0");
    expect(r.shots[1].inheritBlockedByVideoCardId).toBeUndefined();
    expect("inheritBlockedByVideoCardId" in r.shots[1]).toBe(false);
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
// #782 r3(判官 r2 的两条 P1)—— 「这一镜还有没有免费的帧在路上?」
//
// 这条判据只回答那一个问题:有 → 什么都别做(等着,免费的帧正在来);没有 → 商家必须
// 看得见一个自己出一张的入口。r2b 用**两个指针存不存在**当证据回答它,两处都答错了:
//
//   • `firstFrameCardId` 在 ≠ 正在生成。准备卡在商家按 Cancel、启动失败、或刷新崩溃之后
//     照样留在 payload 里 —— 一分钱没花,什么都没在跑。r2b 把它当「在途」,恢复入口
//     凭空消失:Generate all 数不到它,也没有单镜按钮,比 r1 那条死路更深一层。
//
//   • `prev.videoGenerationId` 在 ≠ 交棒这件事已经结束。重出视频会换上新的 `videoCardId`
//     而**故意保留**旧的 `videoGenerationId`(旧片有效到新片落地)。新片还在跑,免费的
//     末帧正在路上,r2b 却已经把这一镜开成付费首帧 —— 商家为一张本该继承的帧多花钱。
//
// 有资格回答的只有闸③ 自己(sync):那是唯一看得见视频作业真实状态的地方。所以判据不再
// 猜,而是读闸③ 留下的判词 `inheritBlockedByVideoCardId` ——「这一张视频子卡已经走完
// 一生,交不出可用的末帧」。判词点名**是哪一张子卡**,于是上一镜一重出(videoCardId
// 换新),旧判词自动失效:新片在跑的窗口里,没有人会被请去多花一分钱。
// ---------------------------------------------------------------------------

describe("#782 r3 shotsStuckWithoutInheritedFrame —— 卡死 vs 还在等", () => {
  it("闸③ 判过「这张片子交不出末帧」→ 卡死", () => {
    const shots = [
      { index: 0, shotId: "s0", firstFrameGenerationId: "ffgen0", videoCardId: "vchild-0", videoGenerationId: "vidgen0" },
      // 供应商键猜错 / 旧 worker 没存末帧 / 下载失败,都由闸③ 落成这同一条判词。
      { index: 1, shotId: "s1", inheritBlockedByVideoCardId: "vchild-0" },
      { index: 2, shotId: "s2" },
    ];
    expect(shotsStuckWithoutInheritedFrame(shots, true).map((s) => s.shotId)).toEqual(["s1"]);
  });

  it("没有判词(闸③ 还没判过 / 上一镜的片子还在跑)→ 是「还在等」,不是卡死", () => {
    const shots = [
      { index: 0, shotId: "s0", firstFrameGenerationId: "ffgen0", videoCardId: "vchild-0" },
      { index: 1, shotId: "s1" },
    ];
    expect(shotsStuckWithoutInheritedFrame(shots, true)).toEqual([]);
  });

  it("判官 r2 P1-b:上一镜重出、新片在跑 → 旧判词点的不是现在这张子卡,一律不放行付费首帧", () => {
    // 重出的形状:videoCardId 换新,videoGenerationId 故意保留旧值(旧片有效到新片落地)。
    const shots = [
      {
        index: 0, shotId: "s0", firstFrameGenerationId: "ffgen0",
        videoCardId: "vchild-0-remake", // 新 job 在跑
        videoGenerationId: "old-vid", // 旧片还在,商家还看得见
      },
      { index: 1, shotId: "s1", inheritBlockedByVideoCardId: "vchild-0" }, // 旧子卡的判词
    ];
    expect(shotsStuckWithoutInheritedFrame(shots, true)).toEqual([]);
  });

  it("判官 r2 P1-b 对照:上一镜没有重出(判词点的就是现在这张子卡)→ 卡死", () => {
    const shots = [
      { index: 0, shotId: "s0", firstFrameGenerationId: "ffgen0", videoCardId: "vchild-0", videoGenerationId: "old-vid" },
      { index: 1, shotId: "s1", inheritBlockedByVideoCardId: "vchild-0" },
    ];
    expect(shotsStuckWithoutInheritedFrame(shots, true).map((s) => s.shotId)).toEqual(["s1"]);
  });

  it("判官 r2 P1-b 对照:上一镜连视频子卡都没有 → 判词无从匹配,是「还在等」", () => {
    const shots = [
      { index: 0, shotId: "s0", firstFrameGenerationId: "ffgen0" }, // 商家还没做这一镜的视频
      { index: 1, shotId: "s1", inheritBlockedByVideoCardId: "vchild-0" }, // 上一轮留下的陈旧判词
    ];
    expect(shotsStuckWithoutInheritedFrame(shots, true)).toEqual([]);
  });

  it("判官 r2 P1-a:这一镜有一张**准备卡**(取消 / 启动失败 / 崩溃后刷新)→ 依然卡死,恢复入口不许消失", () => {
    // 三个分叉在 payload 上是同一个形状:firstFrameCardId 在、firstFrameGenerationId 不在。
    // 「有指针」不等于「在生成」——一分钱没花、什么都没在跑,判据不许拿它当在途。
    for (const branch of ["准备→取消", "准备→启动失败", "准备→崩溃刷新"]) {
      const shots = [
        { index: 0, shotId: "s0", firstFrameGenerationId: "ffgen0", videoCardId: "vchild-0", videoGenerationId: "vidgen0" },
        { index: 1, shotId: "s1", inheritBlockedByVideoCardId: "vchild-0", firstFrameCardId: "child-1" },
      ];
      expect(shotsStuckWithoutInheritedFrame(shots, true).map((s) => s.shotId), branch).toEqual(["s1"]);
      expect(shotsNeedingMintedFirstFrame(shots, true).map((s) => s.shotId), branch).toEqual(["s1"]);
    }
  });

  it("这一镜已经有首帧 → 不算卡死(已经接上了,判词自动失效)", () => {
    const shots = [
      { index: 0, shotId: "s0", firstFrameGenerationId: "ffgen0", videoCardId: "vchild-0", videoGenerationId: "vidgen0" },
      { index: 1, shotId: "s1", firstFrameGenerationId: "inherited-or-own", inheritBlockedByVideoCardId: "vchild-0" },
    ];
    expect(shotsStuckWithoutInheritedFrame(shots, true)).toEqual([]);
  });

  it("接续关 → 恒空集合(这条规则只对接续模式有意义)", () => {
    const shots = [
      { index: 0, shotId: "s0", firstFrameGenerationId: "ffgen0", videoCardId: "vchild-0", videoGenerationId: "vidgen0" },
      { index: 1, shotId: "s1", inheritBlockedByVideoCardId: "vchild-0" },
    ];
    expect(shotsStuckWithoutInheritedFrame(shots, false)).toEqual([]);
  });

  it("按 index 判邻居,不按数组顺序(重排后仍成立)", () => {
    const shuffled = [
      { index: 1, shotId: "s1", inheritBlockedByVideoCardId: "vchild-0" },
      { index: 0, shotId: "s0", firstFrameGenerationId: "ffgen0", videoCardId: "vchild-0", videoGenerationId: "vidgen0" },
    ];
    expect(shotsStuckWithoutInheritedFrame(shuffled, true).map((s) => s.shotId)).toEqual(["s1"]);
  });

  it("第一镜永远不算卡死(它没有上一镜可等,本来就走自己出图那条路)", () => {
    const shots = [
      { index: 0, shotId: "s0", inheritBlockedByVideoCardId: "vchild-x" },
      { index: 1, shotId: "s1", firstFrameGenerationId: "have" },
    ];
    expect(shotsStuckWithoutInheritedFrame(shots, true)).toEqual([]);
  });
});

describe("#782 r3 shotsNeedingMintedFirstFrame 并入卡死镜头 —— 恢复入口不是死路", () => {
  it("卡死的镜头并入需要铸首帧的集合(计入 Generate all,与第一镜一起)", () => {
    const shots = [
      { index: 0, shotId: "s0", firstFrameGenerationId: "ffgen0", videoCardId: "vchild-0", videoGenerationId: "vidgen0" },
      { index: 1, shotId: "s1", inheritBlockedByVideoCardId: "vchild-0" }, // 卡死
      { index: 2, shotId: "s2" }, // 还在等 s1
    ];
    expect(shotsNeedingMintedFirstFrame(shots, true).map((s) => s.shotId)).toEqual(["s1"]);
  });

  it("第一镜也缺帧 + 中间一镜卡死 → 两者都进集合,按 index 排序", () => {
    const shots = [
      { index: 0, shotId: "s0" }, // 第一镜也缺帧
      { index: 1, shotId: "s1", firstFrameGenerationId: "own", videoCardId: "vchild-1", videoGenerationId: "vidgen1" },
      { index: 2, shotId: "s2", inheritBlockedByVideoCardId: "vchild-1" }, // 卡死
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

  it("接续关时判词一律无关(老行为逐字不变:每个缺帧的镜头都要出一张)", () => {
    const shots = [
      { index: 0, shotId: "s0", firstFrameGenerationId: "ffgen0", videoCardId: "vchild-0" },
      { index: 1, shotId: "s1", inheritBlockedByVideoCardId: "vchild-0" },
      { index: 2, shotId: "s2" },
    ];
    expect(shotsNeedingMintedFirstFrame(shots, false).map((s) => s.shotId)).toEqual(["s1", "s2"]);
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

  /**
   * #782 r3(判官 r2 P1-a 的卡面那一半)—— r2b 把「为什么接不上」这句解释藏在
   * `isStuck && !framePending` 后面。于是一张**未消费**的准备卡(取消 / 启动失败 / 崩溃后
   * 刷新)一出现,卡面就只剩一行 "Generating first frame…":既没有解释,也没有下一步。
   * 两行答的是两个不同的问题 —— 这一行答**为什么**不接了(闸③ 已经判定的、关于那条片子的
   * 永久事实),上面那行答**有没有**帧在路上。所以解释不再被进度挡住。
   */
  it("卡死的解释不再被 framePending 挡住(准备卡在,解释和入口也在)", () => {
    expect(CARD_SOURCE).not.toContain("isStuck && !framePending");
    expect(CARD_SOURCE).toContain("{isStuck && (");
    // 「(below)」这个位置词被拿掉了:Generate all 在生成中是隐藏的,指过去会指空。
    expect(CARD_SOURCE).toContain("this shot needs its own");
    expect(CARD_SOURCE).not.toContain("first frame (below)");
  });
});
