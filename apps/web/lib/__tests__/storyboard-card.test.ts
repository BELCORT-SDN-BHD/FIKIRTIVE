import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  shotsNeedingMintedFirstFrame,
  shotsStuckWithoutInheritedFrame,
  nextSyncPhase,
  deriveShotMediaStates,
  ownedMedia,
  hasPendingMedia,
  needsRefreshEntrance,
  parseStoryboardCardPayload,
  MAX_STORYBOARD_SHOTS,
  type ShotMediaState,
  type ShotMediaStatus,
  type ShotMediaSyncReport,
  type SyncPhase,
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


describe("#782 r7 nextSyncPhase —— 「到顶」不等于「放弃」", () => {
  it("服务端说没有活作业了 → 收工(已终局的卡零轮询)", () => {
    expect(nextSyncPhase({ phase: "fast", triesUsed: 1, maxTries: 40, stillPending: false })).toBe("off");
    expect(nextSyncPhase({ phase: "slow", triesUsed: 1, maxTries: 30, stillPending: false })).toBe("off");
  });

  it("本档还有额度 → 原速接着问", () => {
    expect(nextSyncPhase({ phase: "fast", triesUsed: 39, maxTries: 40, stillPending: true })).toBe("fast");
    expect(nextSyncPhase({ phase: "slow", triesUsed: 29, maxTries: 30, stillPending: true })).toBe("slow");
  });

  it("快轮到顶而作业还活着 → 降频再问,不是收工(判官 r6 P1-A 的断点)", () => {
    expect(nextSyncPhase({ phase: "fast", triesUsed: 40, maxTries: 40, stillPending: true })).toBe("slow");
  });

  it("慢轮也到顶 → 才真的停(所以不存在一个永远跑下去的定时器)", () => {
    // r9(判官 r8):停的方式改叫 "exhausted" —— 定时器一样停,但卡面从此分得清
    // 「结束了」和「我们放弃了」。两者对定时器同义,对商家不同义。
    expect(nextSyncPhase({ phase: "slow", triesUsed: 30, maxTries: 30, stillPending: true })).toBe("exhausted");
  });
});

// ---------------------------------------------------------------------------
// #782 r11(判官 r10)—— 合成层:服务端状态 × 轮询相位,**逐格穷举**
//
// r10 的 64 格穷举抓到的是同一个类:客户端拿有损信号去猜服务端的真相。r11 把「猜」删掉了,
// 于是这一层的输入空间也变了 —— 现在是 5 个服务端状态 × 有没有旧产出(替换) × 4 个相位,
// 外加「还没问过服务端」这一轴。下面**逐格遍历**这个空间(标题不再声称超出遍历范围的覆盖),
// 时序本身钉在 storyboard-late-landing.test.ts(真渲染 + 真时钟)。
// ---------------------------------------------------------------------------

const PHASES: SyncPhase[] = ["off", "fast", "slow", "exhausted"];

function shotOf(over: Record<string, unknown> = {}) {
  return { shotId: "s0", index: 0, firstFramePrompt: "", videoPrompt: "", ...over } as Parameters<
    typeof deriveShotMediaStates
  >[0]["shots"][number];
}

function reportOf(frame: ShotMediaStatus, video: ShotMediaStatus, previous?: { generationId: string; url?: string }): ShotMediaSyncReport {
  return {
    shotId: "s0",
    frame: previous ? { status: frame, previous } : { status: frame },
    video: previous ? { status: video, previous } : { status: video },
  };
}

function one(args: {
  shot?: Record<string, unknown>;
  reports?: ShotMediaSyncReport[] | null;
  phase?: SyncPhase;
}) {
  return deriveShotMediaStates({
    shots: [shotOf(args.shot)],
    reports: args.reports ?? null,
    phase: args.phase ?? "fast",
  })[0]!;
}

describe("#782 r11 deriveShotMediaStates —— 5 个服务端状态 × 替换 × 4 个相位,逐格遍历", () => {
  const ALL: ShotMediaStatus[] = [
    { kind: "absent" },
    { kind: "queued" },
    { kind: "generating" },
    { kind: "done", generationId: "gen_0", url: "/m.png" },
    { kind: "done", generationId: "gen_0" }, // 产出在,地址取不到
    { kind: "dead" },
  ];
  const OLD = { generationId: "old_0", url: "/old.png" };

  it("无替换 × 全部相位:状态一一对应,只有「在跑」会被 exhausted 降级", () => {
    for (const status of ALL) {
      for (const phase of PHASES) {
        const s = one({ reports: [reportOf(status, status)], phase });
        const expected =
          status.kind === "absent"
            ? { kind: "absent" }
            : status.kind === "queued" || status.kind === "generating"
              ? phase === "exhausted"
                ? { kind: "stale-unknown", previous: undefined }
                : { kind: "in-progress", previous: undefined }
              : status.kind === "dead"
                ? { kind: "dead", previous: undefined }
                : status.url
                  ? { kind: "landed", generationId: status.generationId, url: status.url }
                  : { kind: "landed-unloaded", generationId: status.generationId };
        expect(s.frame, `frame ${status.kind}/${phase}`).toEqual(expected);
        expect(s.video, `video ${status.kind}/${phase}`).toEqual(expected);
      }
    }
  });

  it("替换在途 × 全部相位:状态说新作业,previous 说旧产出还在(判官 r10 P1 的那一格)", () => {
    for (const status of [{ kind: "queued" } as const, { kind: "generating" } as const]) {
      for (const phase of PHASES) {
        const s = one({ reports: [reportOf(status, status, OLD)], phase });
        const expected =
          phase === "exhausted"
            ? { kind: "stale-unknown", previous: OLD }
            : { kind: "in-progress", previous: OLD };
        expect(s.video, `${status.kind}/${phase}`).toEqual(expected);
        // 商家仍然拥有旧的那一件 —— 卡面据此继续显示它。
        expect(ownedMedia(s.video)).toEqual(OLD);
      }
    }
  });

  it("替换死了 → dead 带 previous:旧产出仍在,且相位不许覆盖这个已确证的事实", () => {
    for (const phase of PHASES) {
      const s = one({ reports: [reportOf({ kind: "dead" }, { kind: "dead" }, OLD)], phase });
      expect(s.video).toEqual({ kind: "dead", previous: OLD });
      expect(ownedMedia(s.video)).toEqual(OLD);
    }
  });

  it("exhausted 不覆盖 dead / done / absent(判官 r10 P2:判定次序)", () => {
    const s = one({
      reports: [reportOf({ kind: "dead" }, { kind: "done", generationId: "vgen_0", url: "/v.mp4" })],
      phase: "exhausted",
    });
    expect(s.frame).toEqual({ kind: "dead", previous: undefined });
    expect(s.video).toEqual({ kind: "landed", generationId: "vgen_0", url: "/v.mp4" });
    const gone = one({ reports: [reportOf({ kind: "absent" }, { kind: "absent" })], phase: "exhausted" });
    expect(gone.frame).toEqual({ kind: "absent" });
    expect(gone.video).toEqual({ kind: "absent" });
  });

  it("多镜头:每一镜各读自己那份回答,一镜的相位不牵连另一镜", () => {
    const states = deriveShotMediaStates({
      shots: [
        shotOf({ shotId: "a", firstFrameCardId: "ca", videoCardId: "va" }),
        shotOf({ shotId: "b", index: 1, firstFrameCardId: "cb", videoCardId: "vb" }),
      ],
      reports: [
        { shotId: "a", frame: { status: { kind: "generating" } }, video: { status: { kind: "generating" } } },
        { shotId: "b", frame: { status: { kind: "done", generationId: "g", url: "/f.png" } }, video: { status: { kind: "dead" } } },
      ],
      phase: "exhausted",
    });
    expect(states[0]!.video.kind).toBe("stale-unknown"); // A 还在等 → 诚实降级
    expect(states[1]!.video).toEqual({ kind: "dead", previous: undefined }); // B 已确证 → 一格不动
    expect(states[1]!.frame.kind).toBe("landed");
  });

  it("sync 缺席这一轴:回答里没有这一镜 → 回到 payload 开场态,不假装在跑", () => {
    // 服务端答了,但答的是别的镜头(重排 / 删除之后的一瞬)。
    const s = one({
      shot: { firstFrameCardId: "c0", videoCardId: "v0" },
      reports: [{ shotId: "other", frame: { status: { kind: "absent" } }, video: { status: { kind: "absent" } } }],
    });
    expect(s.frame.kind).toBe("in-progress"); // 开场态:钱可能刚花出去
    expect(s.video.kind).toBe("in-progress");
  });

  it("还没问过服务端(reports=null)→ 有产出去装载、有子卡先说在跑、都没有就是没开始", () => {
    expect(one({ shot: { firstFrameGenerationId: "gen_0", videoGenerationId: "vgen_0" } })).toEqual({
      shotId: "s0",
      frame: { kind: "landed-unloaded", generationId: "gen_0" },
      video: { kind: "landed-unloaded", generationId: "vgen_0" },
    });
    expect(one({ shot: { firstFrameCardId: "c0", videoCardId: "v0" } })).toEqual({
      shotId: "s0",
      frame: { kind: "in-progress" },
      video: { kind: "in-progress" },
    });
    expect(one({})).toEqual({ shotId: "s0", frame: { kind: "absent" }, video: { kind: "absent" } });
  });

  it("服务端说「这张子卡从来没启动过」→ absent,不是生成中(判官 r10 P2:准备→取消→重开)", () => {
    const s = one({ shot: { firstFrameCardId: "c0", videoCardId: "v0" }, reports: [reportOf({ kind: "absent" }, { kind: "absent" })] });
    expect(s.frame).toEqual({ kind: "absent" });
    expect(s.video).toEqual({ kind: "absent" });
    // 而且没有任何东西值得继续轮询 —— 空转的轮询本身就是那条假 spinner 的动力来源。
    expect(hasPendingMedia([s])).toBe(false);
  });
});

describe("#782 r11 hasPendingMedia —— 轮询继续与否,只问服务端还有没有活作业", () => {
  const st = (frame: ShotMediaState, video: ShotMediaState) => [{ shotId: "s0", frame, video }];

  it("在跑(含替换在途)→ 继续", () => {
    expect(hasPendingMedia(st({ kind: "in-progress" }, { kind: "absent" }))).toBe(true);
    expect(hasPendingMedia(st({ kind: "absent" }, { kind: "in-progress", previous: { generationId: "old" } }))).toBe(true);
  });

  it("落地 / 死了 / 没开始 / 装载不出来 → 停(再问一万次也一样)", () => {
    expect(hasPendingMedia(st({ kind: "landed", generationId: "g", url: "/f" }, { kind: "dead" }))).toBe(false);
    expect(hasPendingMedia(st({ kind: "landed-unloaded", generationId: "g" }, { kind: "absent" }))).toBe(false);
  });
});

describe("#782 r9 needsRefreshEntrance —— 铁律②:不再问了就必须给一条自己问的路", () => {
  const states = (frame: ShotMediaState, video: ShotMediaState) => [{ shotId: "s0", frame, video }];

  it("stale-unknown / landed-unloaded → 要入口", () => {
    expect(needsRefreshEntrance(states({ kind: "stale-unknown" }, { kind: "absent" }), false)).toBe(true);
    expect(needsRefreshEntrance(states({ kind: "absent" }, { kind: "landed-unloaded", generationId: "g" }), true)).toBe(true);
  });

  it("轮询开着的进行中 → 不要入口(卡面正在替商家问)", () => {
    expect(needsRefreshEntrance(states({ kind: "in-progress" }, { kind: "absent" }), true)).toBe(false);
  });

  it("没人在问却还说着进行中 → 要入口(挂载那一次 sync 出错也走这条)", () => {
    expect(needsRefreshEntrance(states({ kind: "in-progress" }, { kind: "absent" }), false)).toBe(true);
  });

  it("有内容 / 有单镜入口的终态 → 不需要这条通用入口", () => {
    expect(needsRefreshEntrance(states({ kind: "landed", generationId: "g", url: "/f.png" }, { kind: "dead" }), false)).toBe(false);
  });
});
