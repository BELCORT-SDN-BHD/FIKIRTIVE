/**
 * otto-research.ts —— 「Otto,读一下我的网站」这件事的**状态机与样例内容**(没有 React)。
 *
 * Founder 2026-08-26 裁决第 3 条:商家给一个网址,Otto 去 research、分类整理,然后**在那个
 * 线程里**呈给商家 approve;批准的落进 Otto IQ 对应的格子。所以这件事从头到尾住在一条
 * 线程里 —— 商家可以关掉面板去做别的,回来接着读、接着答,和他在 Claude Code 开第二个
 * session 是同一种体验。
 *
 * ── 诚实这一条,写死在这里 ────────────────────────────────────────────────────
 * 这一支跑的是**预置样例内容**:下面那三类摘录是写好的,没有任何一次真的去读过商家的
 * 网站。所以每一句商家读得到的话都不冒充抓取结果 —— 呈上去的是「a sample of what this
 * looks like」,页面另有全站那枚 "Prototype · sample data" 徽章说明这一整面的性质。
 * 说清楚不花钱,说错了要还的是商家的信任。
 *
 * ── 五步 ─────────────────────────────────────────────────────────────────────
 *   ① accepted  —— Otto 应承:这要几分钟,你可以先去忙,结果会留在这个对话里
 *   ② working   —— 进度卡逐步推进(读页面 → 整理 → 分好类)
 *   ③ waiting   —— 分类结果呈卡,每类 Approve / Skip
 *   ④ (批准的落进 Otto IQ 对应格,线程里出回执)
 *   ⑤ done      —— 一行工时,线程转完成
 *
 * 计时用**预置值**:样例里的「Worked for 48 seconds」是写好的一个数,不是读时钟算的。
 * 读时钟会让同一份存档每刷新一次就换一个数字,那不是记录,是噪音。
 */
import type { MemoryRow } from "@/lib/memory-actions";
import type { ChatThreadDTO } from "@/lib/types";
import { scopedR22FixtureKey } from "@/components/r22/r22-workspace-fixture";

export type OttoResearchStage = "accepted" | "working" | "waiting" | "done";
export type OttoResearchDecision = "pending" | "approved" | "skipped";

/** 一类整理结果。`slot` 是它在 Otto IQ 里对应的那一格。 */
export type OttoResearchCategory = {
  id: string;
  title: string;
  /** 这一类落进 Otto IQ 的哪个格子(与 `R22OttoIQView` 的 `CARDS.categories` 对得上)。 */
  slot: string;
  /** 商家读到的那一格的名字 —— 回执里说「已经存进 Brand Voice」用的就是它。 */
  slotTitle: string;
  excerpts: string[];
  decision: OttoResearchDecision;
};

export type OttoResearchState = {
  site: string;
  stage: OttoResearchStage;
  /** 走到第几步(0 起)。`stage === "working"` 时有意义。 */
  step: number;
  /** 预置工时,不是读时钟算的 —— 见文件顶部。 */
  workedSeconds: number;
  categories: OttoResearchCategory[];
};

/** 进度卡逐条推进的那几行。人话,一个工程词都没有。 */
export const OTTO_RESEARCH_STEPS = [
  "Reading the pages you linked",
  "Pulling out the lines that sound like you",
  "Sorting them into the right places",
] as const;

/** Otto 的应承句(Copilot 形):说清要多久、说清你可以走开、说清结果去哪。 */
export const OTTO_RESEARCH_ACCEPT_LINE =
  "This takes a few minutes. You can go and do something else — I will leave everything in this conversation for you.";

/** 呈给商家看的那一句,逐字说清它是样例,不是刚抓回来的。 */
export const OTTO_RESEARCH_SAMPLE_NOTE =
  "These are sample lines that show how the result is grouped. Nothing was read from your site in this preview.";

/** 每一步大约多久推进一次(样张节拍,几秒内走完)。 */
export const OTTO_RESEARCH_TICK_MS = 900;

/** 预置工时 —— 商家在完成那一行读到的就是这个数。 */
export const OTTO_RESEARCH_WORKED_SECONDS = 48;

/** 入口预填的那个样例网址。 */
export const OTTO_RESEARCH_SAMPLE_SITE = "harvestcandle.co";

function sampleCategories(): OttoResearchCategory[] {
  return [
    {
      id: "voice",
      title: "Brand voice",
      slot: "voice",
      slotTitle: "Brand Voice",
      excerpts: [
        "Warm and plain-spoken — short sentences, no exclamation marks.",
        "Talks about the making, not the discount.",
        "Says \"hand-poured\" rather than \"artisanal\".",
      ],
      decision: "pending",
    },
    {
      id: "products",
      title: "Products",
      slot: "product",
      slotTitle: "Knowledge Base",
      excerpts: [
        "Six scents, each named after a month.",
        "Soy wax, cotton wick, 40 hours of burn time.",
        "Gift boxes ship flat and are refillable.",
      ],
      decision: "pending",
    },
    {
      id: "audience",
      title: "Audience",
      slot: "audience",
      slotTitle: "Audiences",
      excerpts: [
        "People buying a small gift for someone they see often.",
        "Repeat buyers who come back for the same scent.",
      ],
      decision: "pending",
    },
  ];
}

/** 开一件研究托付。`site` 是商家自己给的那一串,原样留着(回执里要还给他看)。 */
export function startOttoResearch(site: string): OttoResearchState {
  return {
    site: site.trim() || OTTO_RESEARCH_SAMPLE_SITE,
    stage: "accepted",
    step: 0,
    workedSeconds: OTTO_RESEARCH_WORKED_SECONDS,
    categories: sampleCategories(),
  };
}

/**
 * 往前一拍。
 *
 * `accepted` → `working`(第一步)→ 逐步 → 最后一步之后 → `waiting`。
 * 已经在 `waiting` / `done` 的原样还回去 —— 那两态等的是商家,不是时钟。
 */
export function advanceOttoResearch(state: OttoResearchState): OttoResearchState {
  if (state.stage === "accepted") return { ...state, stage: "working", step: 0 };
  if (state.stage !== "working") return state;
  if (state.step < OTTO_RESEARCH_STEPS.length - 1) return { ...state, step: state.step + 1 };
  return { ...state, stage: "waiting" };
}

/** 这一拍之后还需不需要再敲一下(界面靠它决定要不要再排一个定时器)。 */
export function ottoResearchTicking(state: OttoResearchState): boolean {
  return state.stage === "accepted" || state.stage === "working";
}

/**
 * 商家对一类下了判断。全部下完(一条 pending 都不剩)线程就转完成。
 *
 * Skip **什么都不落** —— 商家跳过一类,Otto IQ 里就不该多出这一类的任何一条。
 */
export function decideOttoResearchCategory(
  state: OttoResearchState,
  categoryId: string,
  decision: Exclude<OttoResearchDecision, "pending">,
): OttoResearchState {
  const categories = state.categories.map((category) =>
    category.id === categoryId ? { ...category, decision } : category,
  );
  const settled = categories.every((category) => category.decision !== "pending");
  return { ...state, categories, stage: settled ? "done" : state.stage };
}

/** 批准了几类(回执那句话要报这个数)。 */
export function ottoResearchApprovedCount(state: OttoResearchState): number {
  return state.categories.filter((category) => category.decision === "approved").length;
}

/** 落进 Otto IQ 的那一条长什么样。id 稳定 = 同一类批两次也只有一条。 */
export function ottoResearchMemoryRow(state: OttoResearchState, category: OttoResearchCategory): MemoryRow {
  return {
    id: `fixture-research-${category.id}`,
    category: category.slot,
    content: `${category.title} from ${state.site}: ${category.excerpts.join(" ")}`,
    source: "user",
    pinned: false,
    updatedAt: new Date(OTTO_RESEARCH_FIXTURE_UPDATED_AT),
  };
}

/** 样张里一律用这一刻,不读时钟(与 Otto IQ 那一面同一个常量口径)。 */
export const OTTO_RESEARCH_FIXTURE_UPDATED_AT = "2026-08-25T08:42:00.000Z";

/* ── 一条研究线程长什么样(两个入口共用这一份)────────────────────────────────── */

/** 这条线程的 id —— 每一件托付一条,不复用上一条(上一件的记录要留得住)。 */
export function ottoResearchThreadId(ordinal: number): string {
  return `fixture-research-${ordinal}`;
}

/**
 * 建一条研究线程:商家说的那句话在前,Otto 的应承句在后,整件事的状态挂在应承句的
 * payload 上。
 *
 * 两个入口(Otto IQ 那颗按钮、面板输入框贴链接)共用这一份 —— 各建各的线程就等于同一件事
 * 在两处长得不一样,而商家分不出他刚才是从哪一扇门进来的。
 */
export function buildOttoResearchThread(input: {
  projectId: string;
  site: string;
  said: string;
  ordinal: number;
  now: string;
}): ChatThreadDTO {
  const id = ottoResearchThreadId(input.ordinal);
  const state = startOttoResearch(input.site);
  return {
    id,
    projectId: input.projectId,
    title: `Read ${state.site}`,
    updatedAt: input.now,
    pinnedAt: null,
    status: "working",
    messages: [
      { id: `${id}-user-1`, role: "USER", kind: "TEXT", seq: 1, text: input.said, payload: null, genJobId: null, createdAt: input.now },
      {
        id: `${id}-agent-2`,
        role: "AGENT",
        kind: "TEXT",
        seq: 2,
        text: OTTO_RESEARCH_ACCEPT_LINE,
        payload: { ottoResearch: state },
        genJobId: null,
        createdAt: input.now,
      },
    ],
  };
}

/** 已经有几条研究线程了(下一条排号用) —— 刷新之后接着数,不从 1 重来。 */
export function nextOttoResearchOrdinal(threads: readonly { id: string }[]): number {
  return threads.reduce((highest, thread) => {
    const match = /^fixture-research-(\d+)$/.exec(thread.id);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0) + 1;
}

/* ── 商家贴进来的那串字是不是一个网址 ────────────────────────────────────────── */

/**
 * 面板输入框里贴一条链接也算一次托付(裁决第 3 条的第二个入口)。
 *
 * 判断有意收窄:必须整句就是那一串,或者带 `http(s)://` / `www.`。「我的网站是
 * harvestcandle.co,帮我看看首页文案」这种句子里也认得出网址 —— 但一句正常的问话里
 * 出现一个域名就抢答,商家会觉得 Otto 听不懂人话。
 */
const SITE_RE = /\b(?:https?:\/\/|www\.)[^\s]+|\b[a-z0-9][a-z0-9-]*\.(?:com|co|my|shop|store|net|org)(?:\/[^\s]*)?\b/i;

export function siteLinkIn(text: string): string | null {
  const match = SITE_RE.exec(text.trim());
  return match ? match[0].replace(/[.,)]+$/, "") : null;
}

/* ── 从 Otto IQ 那扇门发起的托付,交给面板去开线程 ──────────────────────────── */

const REQUEST_KEY = "r22:otto-research:request:v1";

/** Otto IQ 上按下那颗按钮时留个条,面板下一次打开就把它变成一条线程。 */
export function requestOttoSiteResearch(site: string): void {
  try {
    window.sessionStorage.setItem(scopedR22FixtureKey(REQUEST_KEY), site);
  } catch {
    /* The panel still opens; the merchant can paste the link into the composer. */
  }
}

/** 取走那个条(取一次就没了 —— 不然每次开面板都会再开一条重复的线程)。 */
export function takeOttoSiteResearchRequest(): string | null {
  try {
    const key = scopedR22FixtureKey(REQUEST_KEY);
    const site = window.sessionStorage.getItem(key);
    if (site) window.sessionStorage.removeItem(key);
    return site;
  } catch {
    return null;
  }
}
