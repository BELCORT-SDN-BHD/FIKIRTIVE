/**
 * #645 T4 视频档位扩容 —— 这一档卖什么、收多少、赚多少,一个文件说完。
 *
 * Founder 价格表裁决(2026-08-06,留档:
 * https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/645#issuecomment-5202464378):
 *   - 按秒计价、显示 credits 进位取整;480p = 1.1cr/秒、720p = 2.2cr/秒;
 *   - 已裁的 5s=11cr / 10s=22cr 一个数不动(下面 REGRESSION 段逐字钉死);
 *   - 720p 的 5/10/15 秒在**最差比例**下毛利 44.67%,低于 45.0% 地板 —— Founder 明示接受,
 *     闸中留具名豁免行。
 *
 * 这里的每个数字要么来自那份裁决(收费),要么来自官方定价页与像素表(成本),没有第三个来源。
 */
import { describe, it, expect } from "vitest";
import {
  GEN_VIDEO_MODEL_OPTIONS,
  videoDefaults,
  genRequest,
  SEEDANCE_VIDEO_PIXELS,
  SEEDANCE_COGS_USD_PER_SECOND,
  BYTEPLUS_USD_PER_MTOKEN,
  VIDEO_ASPECT_ADAPTIVE,
  type GenVideoModel,
} from "./gen.js";
import { pricedGenCredits, genSpentUsd, INTERNAL_PER_DISPLAY, CREDITS_PER_USD, videoGuardrailInternal, REFERENCE_VIDEO_CREDITS, SEEDANCE_DISPLAY_CREDITS_PER_10S, seedanceDisplayCredits } from "./spend.js";
import { MARGIN_FLOOR, marginTruthTable, acceptedExceptionFor, BELOW_FLOOR_FOUNDER_ACCEPTED } from "./margin-truth.js";
import { OTTO_CONVERSATION_TURN_MARGIN } from "./otto-budget.js";

const MODEL: GenVideoModel = "seedance-2-mini";

/** Founder 裁决的全表(4→15 秒),逐格手抄自裁决评论 —— 与代码里的公式**独立**。
 *  公式改一格、或有人把某一档"优化"成别的数,这张表当场变红。 */
const FOUNDER_PRICE_TABLE: readonly { seconds: number; "480p": number; "720p": number }[] = [
  { seconds: 4, "480p": 5, "720p": 9 },
  { seconds: 5, "480p": 6, "720p": 11 },
  { seconds: 6, "480p": 7, "720p": 14 },
  { seconds: 7, "480p": 8, "720p": 16 },
  { seconds: 8, "480p": 9, "720p": 18 },
  { seconds: 9, "480p": 10, "720p": 20 },
  { seconds: 10, "480p": 11, "720p": 22 },
  { seconds: 11, "480p": 13, "720p": 25 },
  { seconds: 12, "480p": 14, "720p": 27 },
  { seconds: 13, "480p": 15, "720p": 29 },
  { seconds: 14, "480p": 16, "720p": 31 },
  { seconds: 15, "480p": 17, "720p": 33 },
];

const videoJob = (seconds: number, resolution: string) => ({
  kind: "VIDEO" as const,
  model: MODEL,
  count: 1,
  videoOptions: { seconds, resolution, audio: true },
});

/** MONEY-A3 护栏价的**独立手抄复算**(与 FOUNDER_PRICE_TABLE 同一个用法:测试这一侧手抄,
 *  生产那一侧推导,两边对不上就当场变红)。规矩三条:费率取这一档自己的每 10 秒价、
 *  分辨率不认识取全表最贵档(110)、秒数畸形按最长可售档(15 秒)计。 */
const GUARDRAIL_RATE_PER_10S: Record<string, number> = { "480p": 11, "720p": 22, "1080p": 110 };
const guardrail = (seconds: unknown, resolution: string) => {
  const rate = GUARDRAIL_RATE_PER_10S[resolution] ?? 110;
  const billed =
    typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 15;
  return Math.ceil((billed * rate) / 10 - 1e-9) * INTERNAL_PER_DISPLAY;
};

// ── 1. 档位表:卖什么 ────────────────────────────────────────────────────────
describe("#645 T4 档位表(引擎真能给的每一档,一格不多一格不少)", () => {
  const o = GEN_VIDEO_MODEL_OPTIONS[MODEL];

  it("时长 = 4…15 全部整秒(引擎约束 duration ∈ [4,15])", () => {
    expect([...o.durations].sort((a, b) => a - b)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });

  it("分辨率 = 480p + 720p(Fast 无 1080p)", () => {
    expect([...o.resolutions].sort()).toEqual(["480p", "720p"]);
  });

  it("比例 = 六比例 + adaptive", () => {
    expect([...o.aspectRatios].sort()).toEqual(["1:1", "16:9", "21:9", "3:4", "4:3", "9:16", "adaptive"].sort());
    expect(o.aspectRatios).toContain(VIDEO_ASPECT_ADAPTIVE);
  });

  it("「智能时长 -1」不做(已挂 #359)—— 菜单上不许出现负数或 0", () => {
    for (const d of o.durations) expect(d).toBeGreaterThan(0);
  });
});

// ── 2. 默认值:商家什么都不选时交付什么 ──────────────────────────────────────
describe("#645 T4 默认值(与今日逐字一致 —— 扩容不许悄悄改默认)", () => {
  it("t2v 默认 = 720p / 5 秒 / 16:9,与扩容前完全一致", () => {
    const d = videoDefaults(MODEL);
    expect(d.resolution).toBe("720p");
    expect(d.seconds).toBe(5);
    expect(d.aspectRatio).toBe("16:9");
    expect(d.audio).toBe(true);
  });

  it("i2v 默认比例 = adaptive(镜像 T1「改这张图不变形状」—— 引擎按首帧自动就近)", () => {
    const d = videoDefaults(MODEL, { hasSourceImage: true });
    expect(d.aspectRatio).toBe(VIDEO_ASPECT_ADAPTIVE);
    // 其余三项与 t2v 同 —— 只有形状分开处理。
    expect(d.resolution).toBe("720p");
    expect(d.seconds).toBe(5);
    expect(d.audio).toBe(true);
  });

  it("默认值是显式的,不是「列表第一格」—— 列表重排不许改默认", () => {
    const o = GEN_VIDEO_MODEL_OPTIONS[MODEL];
    const d = videoDefaults(MODEL);
    expect(o.durations).toContain(d.seconds);
    expect(o.resolutions).toContain(d.resolution);
    expect(o.aspectRatios).toContain(d.aspectRatio);
  });
});

// ── 3. 定价:收多少 ──────────────────────────────────────────────────────────
describe("#645 T4 定价 = Founder 已裁的按秒表(显示 credits)", () => {
  it.each(FOUNDER_PRICE_TABLE)("$seconds 秒:480p = $480p cr,720p = $720p cr", (row) => {
    expect(pricedGenCredits(videoJob(row.seconds, "480p"))).toBe(row["480p"] * INTERNAL_PER_DISPLAY);
    expect(pricedGenCredits(videoJob(row.seconds, "720p"))).toBe(row["720p"] * INTERNAL_PER_DISPLAY);
  });

  it("REGRESSION:5s/10s 的 11cr / 22cr 与调价前(#644)逐字相等 —— 已裁数字一个不动", () => {
    expect(pricedGenCredits(videoJob(5, "720p"))).toBe(11 * INTERNAL_PER_DISPLAY);
    expect(pricedGenCredits(videoJob(10, "720p"))).toBe(22 * INTERNAL_PER_DISPLAY);
  });

  it("480p 是 720p 的半价档:每秒费率恰好一半,进位后每一档都更便宜", () => {
    // 半价是**费率**上的半价(1.1 : 2.2);显示 credits 各自进位后不一定正好两倍 ——
    // 例如 5 秒是 6cr : 11cr(6×2=12≠11),因为 480p 的 5.5 被进位到 6。
    expect(SEEDANCE_DISPLAY_CREDITS_PER_10S["480p"]! * 2).toBe(SEEDANCE_DISPLAY_CREDITS_PER_10S["720p"]);
    for (const row of FOUNDER_PRICE_TABLE) {
      const half = pricedGenCredits(videoJob(row.seconds, "480p"));
      const full = pricedGenCredits(videoJob(row.seconds, "720p"));
      expect(half, `${row.seconds}s:480p 必须比 720p 便宜`).toBeLessThan(full);
      // 进位最多各带 1 个显示 credit 的误差,所以 |2×半 − 全| ≤ 2cr。
      expect(Math.abs(half * 2 - full)).toBeLessThanOrEqual(2 * INTERNAL_PER_DISPLAY);
    }
  });

  it("同一档问两次一定同价(quote == reserve == settle 的地基:纯函数、确定性)", () => {
    for (const row of FOUNDER_PRICE_TABLE) {
      for (const r of ["480p", "720p"]) {
        expect(pricedGenCredits(videoJob(row.seconds, r))).toBe(pricedGenCredits(videoJob(row.seconds, r)));
      }
    }
  });

  it("声音开关不改价(2.0 系列同价)", () => {
    for (const r of ["480p", "720p"]) {
      const on = pricedGenCredits({ ...videoJob(7, r), videoOptions: { seconds: 7, resolution: r, audio: true } });
      const off = pricedGenCredits({ ...videoJob(7, r), videoOptions: { seconds: 7, resolution: r, audio: false } });
      expect(on).toBe(off);
    }
  });

  it("FAIL CLOSED(MONEY-A3):畸形秒数(0 / 负数 / NaN)按**最长可售档**收护栏价,绝不算成免费", () => {
    // 这些只可能来自畸形或历史 videoOptions JSON 行。按秒公式对 0 会算出 0 credits ——
    // 那就是一条**免费**的付费任务;宁可收护栏价,也不贱卖(方向与 #645 之前一致)。
    // MONEY-A3 只改了「收多少」:旧写法一律 16cr,现在按这一档自己的费率 × 15 秒
    // (720p ⇒ 33cr、480p ⇒ 17cr)—— 畸形不知道是几秒,就按最贵的时长算。
    for (const seconds of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(seedanceDisplayCredits(MODEL, "720p", seconds), `seconds=${seconds}`).toBeNull();
      expect(pricedGenCredits(videoJob(seconds, "720p")), `seconds=${seconds}`)
        .toBe(guardrail(seconds, "720p"));
      expect(pricedGenCredits(videoJob(seconds, "480p")), `480p seconds=${seconds}`)
        .toBe(guardrail(seconds, "480p"));
    }
    expect(guardrail(0, "720p")).toBe(330);   // 15 × 2.2cr/秒
    expect(guardrail(0, "480p")).toBe(170);   // 15 × 1.1cr/秒 ⇒ ceil(16.5)
    // 正常档位不受影响。
    expect(seedanceDisplayCredits(MODEL, "720p", 5)).toBe(11);
    expect(seedanceDisplayCredits(MODEL, "480p", 5)).toBe(6);
  });

  it("FAIL CLOSED(判官 r1 P0-1 / MONEY-A3):**正的非整数**秒同样落护栏,绝不 round", () => {
    // 价格只定义在 Founder 裁过的**整数**格上。格外的秒数一律护栏 —— round 等于替
    // Founder 发明价格:0.4s 会 round 成 0 ⇒ 0cr(reserveCredits 对 cost<=0 直接跳过,
    // 也就是**免费出片**);4.4s 会 round 成 4 ⇒ 9cr,一个从没被裁过的价。
    // MONEY-A3:护栏这一侧对正的非整数秒**向上**取整(4.4s 按 5s 收),方向仍然是「宁可贵」。
    for (const seconds of [0.4, 4.4, 14.999, 5.5, 0.999]) {
      expect(seedanceDisplayCredits(MODEL, "720p", seconds), `720p ${seconds}s`).toBeNull();
      expect(seedanceDisplayCredits(MODEL, "480p", seconds), `480p ${seconds}s`).toBeNull();
      expect(pricedGenCredits(videoJob(seconds, "720p")), `720p ${seconds}s`)
        .toBe(guardrail(seconds, "720p"));
      expect(pricedGenCredits(videoJob(seconds, "480p")), `480p ${seconds}s`)
        .toBe(guardrail(seconds, "480p"));
      expect(pricedGenCredits(videoJob(seconds, "720p")), `720p ${seconds}s 绝不免费`).toBeGreaterThan(0);
    }
    expect(guardrail(4.4, "720p")).toBe(110); // ceil(4.4)=5 秒 × 2.2cr
    expect(guardrail(0.4, "720p")).toBe(30);  // ceil(0.4)=1 秒 × 2.2 ⇒ ceil(2.2)=3cr,不是 0
    // 已裁的整数格一格未动。
    for (const row of FOUNDER_PRICE_TABLE) {
      expect(seedanceDisplayCredits(MODEL, "720p", row.seconds)).toBe(row["720p"]);
      expect(seedanceDisplayCredits(MODEL, "480p", row.seconds)).toBe(row["480p"]);
    }
  });

  it("FAIL CLOSED(判官 r2 P0 / MONEY-A3):**已裁 12 档以外的正整数**同样落护栏(按档,不是定额)", () => {
    // 上一轮只封住了非整数,没封住「整数但不在已裁的十二格里」。新请求那侧有 zod 拦着,
    // 但 GenJob.videoOptions 是**无约束 JSON**,worker 的两条历史重算路
    // (apps/worker/src/jobs/gen.ts 的 GEN_RESULT 两处)直达价格函数,那条路上没有 zod。
    //
    // 菜单价那一侧原则不变:**只定义在已裁格上,格外不 round、不外推**(下面 durations 那条
    // 测试逐格钉死)。变的是**护栏收多少**:MONEY-A3 之前一律 16cr,而 16s@720p 的成本就是
    // $1.22 —— 16cr=$1.60 只剩 24% 毛利,穿了 45% 宪法地板。护栏改按这一档自己的费率算,
    // 于是每一个时长都 ≥65% 公式价(下面逐档验算)。
    for (const seconds of [1, 2, 3, 16, 20, 100]) {
      expect(pricedGenCredits(videoJob(seconds, "720p")), `720p ${seconds}s`)
        .toBe(guardrail(seconds, "720p"));
      expect(pricedGenCredits(videoJob(seconds, "480p")), `480p ${seconds}s`)
        .toBe(guardrail(seconds, "480p"));
      // 护栏价对**每一个**时长都不低于 65% 公式价 —— 这正是单一定额挡不住的那件事。
      for (const r of ["720p", "480p"] as const) {
        const priceUsd = guardrail(seconds, r) / CREDITS_PER_USD;
        const costUsd = seconds * SEEDANCE_COGS_USD_PER_SECOND[r];
        expect((priceUsd - costUsd) / priceUsd, `${r} ${seconds}s 护栏毛利`).toBeGreaterThanOrEqual(0.65 - 1e-9);
      }
    }
    expect(guardrail(16, "720p")).toBe(360); // 旧值 160(毛利 24%,穿地板)⇒ 现 36cr
    expect(guardrail(3, "720p")).toBe(70);
    // 已裁的十二格一格未动(护栏不许误伤真档位)。
    for (const row of FOUNDER_PRICE_TABLE) {
      expect(pricedGenCredits(videoJob(row.seconds, "720p")), `720p ${row.seconds}s`)
        .toBe(row["720p"] * INTERNAL_PER_DISPLAY);
      expect(pricedGenCredits(videoJob(row.seconds, "480p")), `480p ${row.seconds}s`)
        .toBe(row["480p"] * INTERNAL_PER_DISPLAY);
    }
  });

  it("判据的单一事实来源 = 能力表的 durations,不是抄一份 [4..15] 字面量", () => {
    // 有菜单价的那一组秒数,必须**恰好**等于这个模型菜单上开出来的那一组 —— 两边靠
    // 同一份 GEN_VIDEO_MODEL_OPTIONS 推导,所以 T6 或未来改档时不可能分家。
    //
    // MONEY-A3 之前这里用的分辨法是「两个分辨率同价 ⇔ 走了护栏」(护栏当时是一个与
    // 分辨率无关的 16cr 定额)。护栏改成按档之后它对两档也给不同价,那个分辨法失效了 ——
    // 换成直接问菜单价函数:`seedanceDisplayCredits` 返回 null ⇔ 这一秒数没有菜单价。
    // 判据更直,而且不再依赖「护栏碰巧撞不上真档位价」这种间接证据。
    const menu = GEN_VIDEO_MODEL_OPTIONS[MODEL].durations;
    const seconds = [...Array(120).keys()].map((i) => i + 1);
    const menuPriced = seconds.filter((s) => seedanceDisplayCredits(MODEL, "720p", s) !== null);
    expect(menuPriced.sort((a, b) => a - b)).toEqual([...menu].sort((a, b) => a - b));
    // 菜单外的每一秒都落护栏,而且护栏与菜单价**不共用**一条路(算出来的数就是护栏的数)。
    for (const s of seconds.filter((x) => !menu.includes(x))) {
      expect(pricedGenCredits(videoJob(s, "720p")), `${s}s 应落护栏`).toBe(videoGuardrailInternal("720p", s));
    }
  });

  it("MONEY-A3:1080p 改按秒 11cr/秒(5s=55cr,16cr 倒挂已修)、未知分辨率按最贵档护栏、整段参考视频仍 16cr", () => {
    // 旧行为:1080p 与未知分辨率一律 16cr 定额。1080p 5 秒的成本 $1.8867,16cr=$1.60 ⇒
    // 毛利 −17.9%(卖一单亏一单),15 秒档 −253.8%。S1 已裁 1080p = 11cr/秒。
    expect(SEEDANCE_DISPLAY_CREDITS_PER_10S["1080p"]).toBe(110);
    expect(pricedGenCredits(videoJob(5, "1080p"))).toBe(550);
    expect(pricedGenCredits(videoJob(15, "1080p"))).toBe(1650);
    // 未知分辨率:结算路径兜底 = 最贵可售档按秒价(110/10s),并由 worker 侧报警(A3 后半句)。
    expect(pricedGenCredits(videoJob(5, "4K"))).toBe(guardrail(5, "4K"));
    expect(pricedGenCredits(videoJob(5, ""))).toBe(guardrail(5, ""));
    expect(guardrail(5, "4K")).toBe(550);
    // 整段参考视频的收费一格没动(好记数 16 ≥ 公式价 15)。
    expect(REFERENCE_VIDEO_CREDITS).toBe(16);
    expect(pricedGenCredits({ ...videoJob(5, "720p"), referenceVideoGenerationId: "gen_ref" }))
      .toBe(16 * INTERNAL_PER_DISPLAY);
  });
});

// ── 4. 成本:按最差比例 ─────────────────────────────────────────────────────
describe("#645 T4 成本基准 = 官方像素表的**最差比例**(永不低估)", () => {
  it("像素表逐格对上官方 Create-task 文档(2026-07-31)", () => {
    expect(SEEDANCE_VIDEO_PIXELS["480p"]).toEqual({
      "16:9": [864, 496], "4:3": [752, 560], "1:1": [640, 640],
      "3:4": [560, 752], "9:16": [496, 864], "21:9": [992, 432],
    });
    expect(SEEDANCE_VIDEO_PIXELS["720p"]).toEqual({
      "16:9": [1280, 720], "4:3": [1112, 834], "1:1": [960, 960],
      "3:4": [834, 1112], "9:16": [720, 1280], "21:9": [1470, 630],
    });
  });

  it("最差比例 = 720p 的 4:3/3:4(927,408px)与 480p 的 21:9(428,544px)", () => {
    const worst = (res: "480p" | "720p") =>
      Math.max(...Object.values(SEEDANCE_VIDEO_PIXELS[res]).map(([w, h]) => w * h));
    expect(worst("720p")).toBe(927_408);
    expect(worst("480p")).toBe(428_544);
  });

  it("#769 每秒成本 = 最差像素 × 24fps / 1024 × mini 牌价 $3.50/M", () => {
    // 像素表与 24fps 是 Seedance 2.0 全系共用的,换 fast→mini 一格没动;
    // 变的只有每 M token 的牌价:$5.60/M → $3.50/M。
    expect(BYTEPLUS_USD_PER_MTOKEN).toBe(3.5);
    // 720p:927,408 × 24 / 1024 = 21,736.125 tok/s → $0.0760764375/s(fast 时代 $0.1217223)
    expect(SEEDANCE_COGS_USD_PER_SECOND["720p"]).toBeCloseTo(0.0760764375, 9);
    // 480p:428,544 × 24 / 1024 = 10,044 tok/s → $0.035154/s(fast 时代 $0.0562464)
    expect(SEEDANCE_COGS_USD_PER_SECOND["480p"]).toBeCloseTo(0.035154, 9);
  });

  it("genSpentUsd 按分辨率走各自的每秒成本;未知分辨率回落到**更贵**的 720p(不许低估)", () => {
    expect(genSpentUsd(videoJob(5, "720p"))).toBeCloseTo(5 * 0.0760764375, 9);
    expect(genSpentUsd(videoJob(5, "480p"))).toBeCloseTo(5 * 0.035154, 9);
    expect(genSpentUsd(videoJob(5, "4K"))).toBeCloseTo(5 * 0.0760764375, 9);
  });

  it("#769 整段参考视频的记账成本 = $0.49896(含视频输入档 $2.10/M,16:9 基准)", () => {
    expect(genSpentUsd({ ...videoJob(5, "720p"), referenceVideoGenerationId: "gen_ref" }))
      .toBeCloseTo(0.49896, 6);
  });
});

// ── 5. 毛利:全表 24 档 + 具名豁免 ───────────────────────────────────────────
describe("#645 T4 毛利真值表(2 分辨率 × 12 时长 = 24 行,穷举)", () => {
  const rows = new Map(marginTruthTable().map((r) => [r.id, r]));

  it("24 个可售视频档全部在毛利表上", () => {
    for (const row of FOUNDER_PRICE_TABLE) {
      for (const r of ["480p", "720p"]) {
        expect(rows.has(`video:${MODEL}:${row.seconds}:${r}`), `缺档位 ${row.seconds}s ${r}`).toBe(true);
      }
    }
    const videoRows = [...rows.keys()].filter((id) => id.startsWith(`video:${MODEL}:`) && !id.endsWith(":ref"));
    expect(videoRows).toHaveLength(24);
  });

  it("480p 全表清地板(#769 后最低 68.0%)", () => {
    for (const row of FOUNDER_PRICE_TABLE) {
      const r = rows.get(`video:${MODEL}:${row.seconds}:480p`)!;
      expect(r.clearsFloor, `480p ${row.seconds}s 毛利 ${(r.margin * 100).toFixed(2)}%`).toBe(true);
      expect(r.margin).toBeGreaterThan(0.68);
    }
  });

  it("#769 720p 全表也清地板了(最低 65.4%)—— fast 时代 5/10/15 秒的 44.67% 缺口被成本降没了", () => {
    // 换引擎前:2.2cr/秒在 5/10/15 秒三个整点不产生进位余量,按最差比例记成本后落到
    // 44.67%,靠 Founder 具名豁免撑着。收费一格没动,成本从 $5.60/M 降到 $3.50/M,
    // 三档回到 65.42% —— 缺口不是被豁免掉的,是被成本降没的。
    const below = FOUNDER_PRICE_TABLE
      .filter((row) => !rows.get(`video:${MODEL}:${row.seconds}:720p`)!.clearsFloor)
      .map((row) => row.seconds);
    expect(below).toEqual([]);
    for (const seconds of [5, 10, 15]) {
      expect(rows.get(`video:${MODEL}:${seconds}:720p`)!.margin).toBeCloseTo(0.654198, 5);
    }
  });

  it("具名豁免名单里没有任何**视频/生成**档 —— 唯一一条是聊天(钱路 M1-c)", () => {
    // 名单的第 2 条规则:「在名单上却已经不跌破了 → 红」。三条 #645 豁免(720p 5/10/15s)
    // 在 mini 成本下全部回到地板之上,所以必须清掉,留着就是一条不再成立的豁免挂在账上。
    // 生成侧因此必须是**零豁免**:任何一档视频/图片重新出现在这张名单上,都是定价倒退。
    expect(BELOW_FLOOR_FOUNDER_ACCEPTED.filter((e) => !e.tier.startsWith("otto:"))).toEqual([]);

    // 钱路 M1-c / Founder 2026-08-18 裁决 9:名单上**有且只有**聊天一条,而且它的字段齐全。
    // 「存在」与「只有它」两句都必须钉住 —— 少了前一句,豁免可以被人悄悄删掉,聊天就又回到
    // 闸外(那正是这次要修的病);少了后一句,这条豁免会变成别人搭便车的口子。
    expect(BELOW_FLOOR_FOUNDER_ACCEPTED.map((e) => e.tier)).toEqual(["otto:chat"]);
    const chat = BELOW_FLOOR_FOUNDER_ACCEPTED[0]!;
    expect(chat.ruledOn).toBe("2026-08-18");
    expect(chat.reason).toContain("聊天是销售员、生成是商品");
    expect(chat.source).toContain("/pull/970");
    // 留档的毛利率必须与**现算**的一致(1 − 1/1.05 = 4.76%),否则就是一条抄错的豁免。
    expect(chat.margin).toBeCloseTo(1 - 1 / OTTO_CONVERSATION_TURN_MARGIN, 9);
    expect(chat.margin).toBeLessThan(MARGIN_FLOOR);
  });

  it("聊天豁免的是**地板**,不是「收费 > 成本」—— 亏着卖照旧禁止", () => {
    // 豁免有边界:1.05 > 1,所以聊天仍然赚钱,只是赚得薄。哪天有人把倍数调到 ≤1,
    // R1(收费 ≤ 成本 → 恒红)会当场拦住它,名单救不了 —— 这一条把那个边界钉死。
    const chatRow = marginTruthTable().find((r) => r.id === "otto:chat")!;
    expect(OTTO_CONVERSATION_TURN_MARGIN).toBeGreaterThan(1);
    expect(chatRow.grossUsd).toBeGreaterThan(0);
    expect(chatRow.clearsFloor).toBe(false);
  });

  it("深研两条腿都清 45% 地板(裁决 9b:research 纳入毛利闸,搜索按 3× 计价)", () => {
    const llm = marginTruthTable().find((r) => r.id === "otto:research:llm")!;
    const search = marginTruthTable().find((r) => r.id === "otto:research:search")!;
    // LLM 腿:默认 **2.06×** ⇒ 面值 51.46%(Founder 2026-09-01 裁决,前值 2.0× = 50%),
    // 清地板且不在任何豁免名单上。CI 闸那边还会按最坏实收口径复判一次(45.73%),
    // 这张表是**面值口径**的报表 —— 两个口径的差是汇率钉点的保守缓冲,见 margin-truth.ts 注释。
    expect(llm.margin).toBeCloseTo(0.5146, 4);
    expect(llm.clearsFloor).toBe(true);
    expect(acceptedExceptionFor("otto:research:llm")).toBeUndefined();
    // 搜索腿:Founder 2026-07-03 裁的 3× ⇒ 66.7%,清地板。
    expect(search.margin).toBeCloseTo(2 / 3, 9);
    expect(search.clearsFloor).toBe(true);
    expect(acceptedExceptionFor("otto:research:search")).toBeUndefined();
  });

  it("跌破地板的档位 ⇔ 具名豁免名单,两边完全重合(新的违规藏不住)", () => {
    for (const r of marginTruthTable()) {
      const accepted = acceptedExceptionFor(r.id) !== undefined;
      expect(accepted, `${r.id} 毛利 ${(r.margin * 100).toFixed(2)}%`).toBe(!r.clearsFloor);
      // 无论在不在名单上,收费低于成本永远不许通过。
      expect(r.grossUsd, `${r.id} 收费低于成本`).toBeGreaterThan(0);
    }
  });

  it("非豁免行照旧必须清 45% 地板", () => {
    for (const r of marginTruthTable()) {
      if (acceptedExceptionFor(r.id)) continue;
      expect(r.margin, `${r.id} 跌破地板且不在豁免名单上`).toBeGreaterThanOrEqual(MARGIN_FLOOR - 1e-9);
    }
  });

  it("毛利表的收费 == pricedGenCredits(报表不是第二份手抄价目表)", () => {
    for (const row of FOUNDER_PRICE_TABLE) {
      for (const r of ["480p", "720p"]) {
        const truth = rows.get(`video:${MODEL}:${row.seconds}:${r}`)!;
        expect(truth.chargeUsd).toBeCloseTo(pricedGenCredits(videoJob(row.seconds, r)) / CREDITS_PER_USD, 9);
      }
    }
  });
});

// ── 6. 契约闸:界外的一格都进不来 ────────────────────────────────────────────
describe("#645 T4 契约闸(genRequest)", () => {
  const base = {
    projectId: "p_1",
    prompt: "a cat",
    entityIds: [],
    count: 1,
    kind: "video" as const,
    model: MODEL,
    idempotencyKey: "k_1",
  };

  it("接受新档:4…15 秒 × 480p/720p × 六比例 + adaptive", () => {
    for (const durationSeconds of GEN_VIDEO_MODEL_OPTIONS[MODEL].durations) {
      for (const resolution of GEN_VIDEO_MODEL_OPTIONS[MODEL].resolutions) {
        for (const aspectRatio of GEN_VIDEO_MODEL_OPTIONS[MODEL].aspectRatios) {
          const parsed = genRequest.safeParse({ ...base, durationSeconds, resolution, aspectRatio });
          expect(parsed.success, `${durationSeconds}s ${resolution} ${aspectRatio} 被拒`).toBe(true);
        }
      }
    }
  });

  it("拒绝界外:3 秒、16 秒、1080p、引擎给不了的比例", () => {
    expect(genRequest.safeParse({ ...base, durationSeconds: 3 }).success).toBe(false);
    expect(genRequest.safeParse({ ...base, durationSeconds: 16 }).success).toBe(false);
    expect(genRequest.safeParse({ ...base, resolution: "1080p" }).success).toBe(false);
    expect(genRequest.safeParse({ ...base, aspectRatio: "2:3" }).success).toBe(false);
  });
});
