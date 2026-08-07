import { describe, it, expect } from "vitest";
import {
  validateScheduleDraft,
  isScheduleChannel,
  SCHEDULE_CHANNEL_CAPS,
  scheduleApproveBlockers,
} from "./schedule-draft.js";

const BASE = {
  channel: "instagram",
  caption: "Hello world",
  scheduledAt: "2026-07-10T09:00:00Z",
  scheduledTz: "Asia/Kuala_Lumpur",
};

function ok(input: Record<string, unknown>) {
  const r = validateScheduleDraft(input as never);
  if ("error" in r) throw new Error(`expected ok, got error: ${r.error}`);
  return r.value;
}
function err(input: Record<string, unknown>): string {
  const r = validateScheduleDraft(input as never);
  if (!("error" in r)) throw new Error("expected an error");
  return r.error;
}

describe("validateScheduleDraft — channel", () => {
  it("accepts the supported channels; rejects others", () => {
    expect(ok({ ...BASE, channel: "instagram" }).channel).toBe("instagram");
    expect(ok({ ...BASE, channel: "facebook" }).channel).toBe("facebook");
    expect(ok({ ...BASE, channel: "x" }).channel).toBe("x");
    expect(err({ ...BASE, channel: "tiktok" })).toMatch(/channel/i);
    expect(err({ ...BASE, channel: undefined })).toMatch(/channel/i);
    expect(isScheduleChannel("instagram")).toBe(true);
    expect(isScheduleChannel("x")).toBe(true);
    expect(isScheduleChannel("tiktok")).toBe(false);
  });
});

describe("validateScheduleDraft — caption", () => {
  it("requires a non-empty caption within the length cap", () => {
    expect(err({ ...BASE, caption: "   " })).toMatch(/caption/i);
    expect(err({ ...BASE, caption: "x".repeat(2201) })).toMatch(/caption/i);
    expect(ok({ ...BASE, caption: "  trimmed  " }).caption).toBe("trimmed");
  });
});

describe("validateScheduleDraft — datetime (strict ISO instant)", () => {
  it("accepts a UTC Z instant and an explicit offset", () => {
    expect(ok({ ...BASE, scheduledAt: "2026-07-10T09:00:00Z" }).scheduledAt).toEqual(new Date("2026-07-10T09:00:00Z"));
    expect(ok({ ...BASE, scheduledAt: "2026-07-10T17:00:00+08:00" }).scheduledAt).toEqual(new Date("2026-07-10T09:00:00Z"));
  });
  it("rejects a naive/local datetime with no timezone designator", () => {
    expect(err({ ...BASE, scheduledAt: "2026-07-10T09:00:00" })).toMatch(/date and time/i);
    expect(err({ ...BASE, scheduledAt: "2026-07-10 09:00" })).toMatch(/date and time/i);
    expect(err({ ...BASE, scheduledAt: "next tuesday" })).toMatch(/date and time/i);
    expect(err({ ...BASE, scheduledAt: "" })).toMatch(/date and time/i);
  });
});

describe("validateScheduleDraft — timezone", () => {
  it("accepts a valid IANA zone; rejects an unknown one", () => {
    expect(ok({ ...BASE, scheduledTz: "America/New_York" }).scheduledTz).toBe("America/New_York");
    expect(err({ ...BASE, scheduledTz: "Mars/Phobos" })).toMatch(/time zone/i);
    expect(err({ ...BASE, scheduledTz: "" })).toMatch(/time zone/i);
  });
});

describe("validateScheduleDraft — channel capabilities", () => {
  it("enforces per-channel maxMediaCount (Facebook = 1, Instagram = 10)", () => {
    expect(SCHEDULE_CHANNEL_CAPS.facebook.maxMediaCount).toBe(1);
    expect(SCHEDULE_CHANNEL_CAPS.instagram.maxMediaCount).toBe(10);
    expect(SCHEDULE_CHANNEL_CAPS.x.maxMediaCount).toBe(0);
    expect(SCHEDULE_CHANNEL_CAPS.x.supportsFirstComment).toBe(false);
    // X is text-only for now (media publishing = external-test phase) → any media is rejected.
    expect(err({ ...BASE, channel: "x", media: ["a"] })).toMatch(/text-only/i);
    expect(ok({ ...BASE, channel: "x" }).media).toEqual([]);
    expect(err({ ...BASE, channel: "facebook", media: ["a", "b"] })).toMatch(/single|carousel/i);
    expect(ok({ ...BASE, channel: "facebook", media: ["a"] }).media).toEqual(["a"]);
    expect(err({ ...BASE, channel: "instagram", media: Array.from({ length: 11 }, (_, i) => `m${i}`) })).toMatch(/at most 10/i);
    expect(ok({ ...BASE, channel: "instagram", media: Array.from({ length: 10 }, (_, i) => `m${i}`) }).media).toHaveLength(10);
  });

  it("rejects a first comment on a channel that doesn't support it (Facebook)", () => {
    expect(err({ ...BASE, channel: "facebook", firstComment: "first!" })).toMatch(/first comment/i);
    expect(ok({ ...BASE, channel: "instagram", firstComment: "first!" }).firstComment).toBe("first!");
    // an empty/whitespace first comment is normalized to null, allowed on any channel
    expect(ok({ ...BASE, channel: "facebook", firstComment: "  " }).firstComment).toBeNull();
  });
});

// #695 —— 「Approve & schedule」的前置条件只能有一份真相。
// 病灶:服务端 approveScheduledPost 按「有账号 + 有媒体」两条规则拒绝,composer 的按钮也
// 灰在同样两条上,但界面只解释了第一条 —— 账号一选,提示就消失,按钮沉默地灰着,商家
// 无从知道真正缺的是「至少挑一张图」。这个纯函数就是那份唯一真相:服务端与 composer
// 都读它,商家看到的句子也来自它,不可能再各说各话。
describe("scheduleApproveBlockers —— approve 前置条件与话术同源 (#695)", () => {
  const LIVE = ["ig-1"]; // 当前真实连着的账号

  it("缺账号时给账号那句;账号到位后不再提", () => {
    expect(scheduleApproveBlockers({ channel: "instagram", targetId: null, mediaCount: 1, connectedTargetIds: LIVE })).toEqual([
      "Pick which account to post to before approving.",
    ]);
    expect(scheduleApproveBlockers({ channel: "instagram", targetId: "ig-1", mediaCount: 1, connectedTargetIds: LIVE })).toEqual([]);
  });

  it("缺媒体时给媒体那句 —— 正是票面上那句从没被说出口的话", () => {
    expect(scheduleApproveBlockers({ channel: "instagram", targetId: "ig-1", mediaCount: 0, connectedTargetIds: LIVE })).toEqual([
      "Add at least one image before approving.",
    ]);
    // Instagram 只收图(#229);Facebook 图片视频都收 —— 话术跟着渠道能力走,不能一句通吃。
    expect(
      scheduleApproveBlockers({ channel: "facebook", targetId: "fb-1", mediaCount: 0, connectedTargetIds: ["fb-1"] }),
    ).toEqual(["Add at least one image or video before approving."]);
  });

  it("两样都缺就两句都给,顺序与 composer 的字段顺序一致", () => {
    expect(scheduleApproveBlockers({ channel: "instagram", targetId: null, mediaCount: 0, connectedTargetIds: LIVE })).toEqual([
      "Pick which account to post to before approving.",
      "Add at least one image before approving.",
    ]);
  });

  it("X 是纯文字渠道(maxMediaCount 0),不要求媒体", () => {
    expect(scheduleApproveBlockers({ channel: "x", targetId: "x-1", mediaCount: 0, connectedTargetIds: ["x-1"] })).toEqual([]);
    expect(scheduleApproveBlockers({ channel: "x", targetId: null, mediaCount: 0, connectedTargetIds: ["x-1"] })).toEqual([
      "Pick which account to post to before approving.",
    ]);
  });

  it("不认识的渠道不编媒体规则 —— 渠道本身的合法性由 isScheduleChannel 那道闸负责", () => {
    expect(scheduleApproveBlockers({ channel: "tiktok", targetId: "t-1", mediaCount: 0, connectedTargetIds: ["t-1"] })).toEqual([]);
  });

  it("每一句都是完整人话,不带字段名或机器码", () => {
    const sentences = [
      ...scheduleApproveBlockers({ channel: "instagram", targetId: null, mediaCount: 0, connectedTargetIds: LIVE }),
      ...scheduleApproveBlockers({ channel: "facebook", targetId: null, mediaCount: 0, connectedTargetIds: ["fb-1"] }),
      ...scheduleApproveBlockers({ channel: "instagram", targetId: "gone", mediaCount: 0, connectedTargetIds: LIVE }),
      ...scheduleApproveBlockers({ channel: "instagram", targetId: "gone", mediaCount: 0, connectedTargetIds: [] }),
    ];
    expect(sentences.length).toBeGreaterThan(0);
    for (const sentence of sentences) {
      expect(sentence).toMatch(/^[A-Z].*\.$/);
      expect(sentence).not.toMatch(/metaTargetId|mediaCount|maxMediaCount|_/);
    }
  });
});

// #741 判官 r1 [P1] —— 「账户有效」曾经有两套真相。
// 草稿里存着的那串 id 只是**曾经**挑过的账号:商家断开连接后它还在,界面据此认定「账号有了」
// 并把批准按钮点亮,服务端 approve 时重读真实连接列表必拒。所以这条规则不能只看「有没有 id」,
// 必须对照「现在真的连着哪些账号」——服务端读的是同一份事实,界面提前说出同一句话。
describe("scheduleApproveBlockers —— 账户有效性对照真实连接 (#741 r1 P1)", () => {
  it("草稿存着的旧 id 不在当前连接列表里:如实说这不是你连着的账号", () => {
    expect(
      scheduleApproveBlockers({ channel: "instagram", targetId: "ig-old", mediaCount: 1, connectedTargetIds: ["ig-new"] }),
    ).toEqual(["That account isn't one of your connected channels."]);
  });

  it("一个账号都没连:指路去连接,而不是叫人「挑一个」不存在的账号", () => {
    expect(
      scheduleApproveBlockers({ channel: "instagram", targetId: "ig-old", mediaCount: 1, connectedTargetIds: [] }),
    ).toEqual(["Connect your account before approving."]);
    // 连 id 都没挑过、也一个都没连 —— 同样是「去连接」,不是「去挑」。
    expect(
      scheduleApproveBlockers({ channel: "instagram", targetId: null, mediaCount: 1, connectedTargetIds: [] }),
    ).toEqual(["Connect your account before approving."]);
  });

  it("陈旧 id 与缺媒体同时存在:两句都给,账号那句在前", () => {
    expect(
      scheduleApproveBlockers({ channel: "instagram", targetId: "ig-old", mediaCount: 0, connectedTargetIds: ["ig-new"] }),
    ).toEqual([
      "That account isn't one of your connected channels.",
      "Add at least one image before approving.",
    ]);
  });

  it("「还没读到连接列表」不等于「没有连接」—— 不知道就不吓人", () => {
    // 省略 connectedTargetIds = 调用方还没读(服务端的第一段检查就是这样),此时只判「挑没挑」。
    expect(scheduleApproveBlockers({ channel: "instagram", targetId: "ig-old", mediaCount: 1 })).toEqual([]);
    expect(
      scheduleApproveBlockers({ channel: "instagram", targetId: "ig-old", mediaCount: 1, connectedTargetIds: null }),
    ).toEqual([]);
    expect(scheduleApproveBlockers({ channel: "instagram", targetId: null, mediaCount: 1 })).toEqual([
      "Pick which account to post to before approving.",
    ]);
  });

  it("空字符串的 id 当作没挑过,不当成一个「连不上的账号」", () => {
    expect(
      scheduleApproveBlockers({ channel: "instagram", targetId: "", mediaCount: 1, connectedTargetIds: ["ig-1"] }),
    ).toEqual(["Pick which account to post to before approving."]);
  });
});
