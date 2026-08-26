/**
 * r22-canvas-fixture.ts —— 画布这一面**两边都要用**的那几件事实,一个 React 节点都没有。
 *
 * 它取代了 `r22-canvas-pack.ts`。那个文件当年解决的是「画布往里写、Library 那面读」——
 * 办法是**再开一个存档**(一个素材包专用的键)。于是同一件东西在浏览器里有两份账:
 * 画布加进包里的图在 Library 的素材包页里根本看不见,两边谁都不会报错。
 * 对账裁决很直接:**Library 的 v2 存档是唯一权威**,画布往它里面写,旧键退役。
 *
 * 留在这个文件里的只有两类东西,理由都是「两面必须逐字对上」:
 *   ① **价目** —— 一张图多少 cr、一张视频概念多少 cr、可选的形状有哪几个。Library 的
 *      Quick create 与画布 composer 报的必须是同一个价;各写各的字面量 = 两处从此各涨各的。
 *   ② **会话存档的形状与键名** —— Quick create 做完之后要把这一批送进画布的会话里
 *      (「Continue in Canvas」)。写的人和读的人不在同一个文件里,键名或版本号错一个字节,
 *      商家点过去看到的就是一块空板,而且没有任何一处会报错。
 */
import { scopedR22FixtureKey } from "@/components/r22/r22-workspace-fixture";

/* ── 价目与形状(唯一出处) ──────────────────────────────────────────────────── */

/** 商家这一次要做的是图还是视频。参数弹层上那个分段控件切的就是它。 */
export type CanvasMakeKind = "image" | "video";

/**
 * 样例画布一张图的价钱。真接后端的那一面读服务端报价(`quoteCosts`),两面共用同一个
 * `imageCredits` 变量往下走 —— 价格贴纸、答案里的单价、批量四张的总价,全从这一处派生。
 */
export const FIXTURE_IMAGE_CREDITS = 3;

/**
 * 一张**视频概念卡**的价钱。V1 这一面做得出的只有概念:一帧占位加一个时长标签,卡上那
 * 句话逐字说清楚它不是一段能播的视频。价钱同样只有这一个出处。
 */
export const FIXTURE_VIDEO_CONCEPT_CREDITS = 6;

/** 概念卡上那个时长标签的秒数 —— 它是一个标签,不是一段真的时间轴。 */
export const FIXTURE_VIDEO_CONCEPT_SECONDS = 6;

/** 样例画布此刻真的可选的那几个形状(参数弹层的比例格与答案卡共用这一份)。 */
export const FIXTURE_RATIO_OPTIONS = ["9:16", "1:1", "4:5", "16:9"];

/** 一次请求的价钱 = 单价 × 张数。张数与类型都从参数弹层来,谁都不许再写第二个乘法。 */
export function fixtureQuoteCredits(kind: CanvasMakeKind, count: number): number {
  return (kind === "video" ? FIXTURE_VIDEO_CONCEPT_CREDITS : FIXTURE_IMAGE_CREDITS) * count;
}

/* ── 板上的东西 ─────────────────────────────────────────────────────────────── */

export type CanvasPoint = { x: number; y: number };

export type FixtureArt = { id: string; label: string; src: string; alt: string; variant?: string };

/**
 * 画布上的一批东西。样例画布开局就有一批,此后每做一次就多一批 —— 新的一批是**并存**,
 * 不是替换:商家刚才那一批还在原地,才比得出这一版好在哪。
 */
export type FixtureBatch = {
  id: string;
  kind: CanvasMakeKind;
  ratio: string;
  credits: number;
  /** 这一批是从哪一张长出来的。`null` = 它自己就是新的一批。 */
  madeFrom: string | null;
  /** 这一批用到的参考图名字。空 = 没用参考图。 */
  references: string[];
  home: CanvasPoint;
  art: FixtureArt[];
};

/** 开局那一批的老家。后面每一批往下摆一格,不叠在一起。 */
export const FIXTURE_BATCH_HOME: CanvasPoint = { x: 1020, y: 520 };

export function fixtureBatchHome(index: number): CanvasPoint {
  return { x: FIXTURE_BATCH_HOME.x, y: FIXTURE_BATCH_HOME.y + 360 * index };
}

/* ── 会话存档(Quick create → 画布 的那条路) ───────────────────────────────── */

/**
 * 会话存档的版本号。画布读到对不上的版本一律当场丢掉、不去猜旧形状,所以写的人也必须
 * 报同一个数 —— 少对上一位,「Continue in Canvas」点过去就是一块空板。
 */
export const CANVAS_FIXTURE_SESSION_VERSION = 2;

/** 会话存档的键(还没带 workspace 后缀 —— 落盘时统一走 `scopedR22FixtureKey`)。 */
export function canvasFixtureSessionKey(projectId: string, threadId: string | null): string {
  return `r22:canvas:${projectId}:${threadId ?? "new"}`;
}

/** 存档里这一面真正关心的两半。其余字段读不到就是「还没做过这件事」,不当坏存档丢。 */
type CanvasFixtureSession = {
  version: number;
  messages?: Array<{ from: "me" | "otto"; text: string } | { from: "answer"; answer: unknown; repeat: boolean }>;
  batches?: FixtureBatch[];
  [key: string]: unknown;
};

function readSession(key: string): CanvasFixtureSession | null {
  try {
    const stored = window.sessionStorage.getItem(key);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as CanvasFixtureSession;
    return parsed?.version === CANVAS_FIXTURE_SESSION_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 把一次 Quick create 送进那块画布的会话里:一条商家说过的话,加一批落在板上的成品。
 *
 * 幂等靠批次 `id`:同一次生成的产物再送一遍,板上不该多出一批一模一样的东西
 * (商家可能来回点两次「Continue in Canvas」,或者刷新之后再点一次)。
 * 返回值说的是「这一次有没有真的写进去」,不是「有没有出错」。
 */
export function appendCanvasFixtureHandoff(input: {
  projectId: string;
  threadId?: string | null;
  prompt: string;
  batch: FixtureBatch;
}): boolean {
  const key = scopedR22FixtureKey(canvasFixtureSessionKey(input.projectId, input.threadId ?? null));
  const existing = readSession(key);
  const batches = existing?.batches ?? [];
  if (batches.some((batch) => batch.id === input.batch.id)) return false;
  const next: CanvasFixtureSession = {
    ...(existing ?? {}),
    version: CANVAS_FIXTURE_SESSION_VERSION,
    messages: [...(existing?.messages ?? []), { from: "me", text: input.prompt }],
    batches: [...batches, { ...input.batch, home: fixtureBatchHome(batches.length + 1) }],
  };
  try {
    window.sessionStorage.setItem(key, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

/* ── 刚建出来的那个项目(Create 对话框 → 画布 的那条路) ─────────────────────── */

/**
 * 商家刚在 Create 对话框里建出来的那个项目,在样张里的固定身份。
 *
 * 为什么必须是一个**登记过的** id:画布入口的 fixture 分支与真实那一支走同一个
 * `selectImmersiveProject` —— 认不出的 projectId 会静默退回名录第一项(Raya launch)。
 * 于是商家刚说完那句话、按下建项目,进去看到的是别人的板,而且没有任何一处会报错。
 * 所以这个 id 与 `ImmersiveCanvasEntry` 的 `FIXTURE_PROJECTS` 是同一个常量。
 */
export const NEW_PROJECT_FIXTURE_ID = "fixture-new-project";

/** 还没人建过项目时,这一格在名录里的名字。真的建了就换成商家那句话派生出来的短名。 */
export const NEW_PROJECT_FIXTURE_FALLBACK_NAME = "New project";

/** 派生出来的短名存在哪(还没带 workspace 后缀 —— 落盘时统一走 `scopedR22FixtureKey`)。 */
const NEW_PROJECT_NAME_KEY = "r22:canvas:new-project-name";

/** 记下这个项目商家读到的名字。存不下就算了 —— 名录里还有一个诚实的兜底名。 */
export function writeNewFixtureProjectName(name: string): void {
  try {
    window.sessionStorage.setItem(scopedR22FixtureKey(NEW_PROJECT_NAME_KEY), name);
  } catch {
    /* 顶栏会退回兜底名,别的一切照常。 */
  }
}

/** 读回那个名字。没有就是「还没人在这一格建过项目」。 */
export function readNewFixtureProjectName(): string {
  try {
    return window.sessionStorage.getItem(scopedR22FixtureKey(NEW_PROJECT_NAME_KEY)) ?? "";
  } catch {
    return "";
  }
}

/**
 * 开一块新板,把**开场那几句话**带进去。
 *
 * 与 `appendCanvasFixtureHandoff` 的分工:那一个是往**已有**的会话后面接一批成品(所以
 * 靠批次 id 幂等);这一个是「这是一个刚建出来的项目」,所以它**整份覆盖** —— 上一次
 * 占着这一格的项目连同它的板一起让位。留着旧存档才是骗人:商家读到的是一块新板的名字,
 * 板上却是上一个项目的东西。
 */
export function startCanvasFixtureConversation(input: {
  projectId: string;
  threadId?: string | null;
  messages: Array<{ from: "me" | "otto"; text: string }>;
}): boolean {
  const key = scopedR22FixtureKey(canvasFixtureSessionKey(input.projectId, input.threadId ?? null));
  try {
    window.sessionStorage.setItem(
      key,
      JSON.stringify({ version: CANVAS_FIXTURE_SESSION_VERSION, messages: input.messages }),
    );
    return true;
  } catch {
    return false;
  }
}
