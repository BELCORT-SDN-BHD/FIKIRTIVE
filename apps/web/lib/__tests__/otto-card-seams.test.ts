/**
 * otto-card-seams — 卡片缝(流桥名单 + 客户端注入过滤)的防复发守卫。
 *
 * 历史:F23 修过一次(卡片提出后不刷新不显示),PERFORMANCE_CARD 又修过一次,
 * RESEARCH_CARD 再次原样复发 —— 因为"新卡片要接进 CARD_TOOL_NAMES / CARD_KINDS"
 * 只存在于人的记忆里。这个测试把它变成机器规则,双向断言:
 *
 *   1. 任何免审批(needsApproval=false)、产卡的 skill 工具名 ∈ CARD_TOOL_NAMES(缝 5);
 *   2. 任何在用的 *_CARD kind ∈ CARD_KINDS(缝 4,injectCardMessage/appendMissingCards
 *      的过滤器 —— 2026-07-04 对抗审查抓到的 blocker:只修缝 5 不修缝 4,卡片照样不显示);
 *   3. CARD_TOOL_NAMES 无过期条目(每个条目都能溯源到一个产卡 skill)。
 *
 * 产卡有两种形态,都要覆盖(2026-07-04 对抗审查抓到的假绿):
 *   - 直接持久化:skill 在 packages/otto/src/skills 里自己 create *_CARD(propose 等);
 *   - 端口持久化:skill 经注入的 web 端口在 apps/web/lib 里 create *_CARD
 *     (propose-meta-action → meta-propose.ts、propose-ad-build → meta-build-propose.ts),
 *     工具名与持久化点跨包,靠下面的 PORT_CARD_TOOLS 清单登记 —— 新端口持久化的卡片
 *     kind 一出现在 web/lib 而不在清单里,测试即红。
 *
 * 审批型 skill(如 generate,cost:"spend")在 worker resume 里执行、无活流,经
 * approve 流程送达,豁免缝 5;其卡片 kind 仍须过缝 4(刷新/回填要渲染)。
 * 已知局限:扫描是词法启发(fs+regex),经变量/拼接构造的 kind 字面量会逃过 ——
 * 但两处扫描 + 双向断言让"完全隐身"需要同时绕过三道网。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CARD_TOOL_NAMES } from "../otto-stream-bridge";
import { CARD_KINDS } from "../otto-inject-helpers";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const SKILLS_DIR = path.join(REPO_ROOT, "packages/otto/src/skills");
const WEB_LIB_DIR = path.join(REPO_ROOT, "apps/web/lib");
const OTTO_CHAT_STREAM = path.join(REPO_ROOT, "apps/web/components/otto/OttoChatStream.tsx");
const OTTO_CONVERSATION = path.join(REPO_ROOT, "apps/web/components/otto/OttoConversation.tsx");

/** 端口持久化的卡片:kind → 提出它的 skill 工具名(跨包,无法从源码推断,手工登记)。 */
const PORT_CARD_TOOLS: Record<string, string> = {
  ACTION_CARD: "propose-meta-action", // persists in apps/web/lib/meta-propose.ts
  BUILD_CARD: "propose-ad-build", // persists in apps/web/lib/meta-build-propose.ts
};

/** worker 侧持久化、非 skill 提出的卡片 kind(缝 4 之外的送达路径,豁免缝 5)。 */
const WORKER_PERSISTED_KINDS = new Set(["RESEARCH_REPORT", "GEN_RESULT"]);

/** defineOttoSkill 三字段 → needsApproval(与 packages/otto/src/skill.ts 同公式)。
 *  正则锚定行首缩进,防止散文注释里的 cost:"spend" 遮蔽真实字段。 */
function needsApproval(src: string): boolean {
  const cost = src.match(/^\s*cost:\s*"(free|spend)"/m)?.[1];
  const effect = src.match(/^\s*effect:\s*"(read|write)"/m)?.[1];
  const reach = src.match(/^\s*reach:\s*"(internal|external)"/m)?.[1];
  if (!cost || !effect || !reach) throw new Error("could not parse the 3 skill fields");
  return cost === "spend" || (effect === "write" && reach === "external");
}

function tsFilesIn(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      out.push(...tsFilesIn(path.join(dir, entry.name)));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/** skills 目录里直接持久化 *_CARD 的 skill:{ toolName, kinds, file, approval } */
function directCardSkills(): { toolName: string; kinds: string[]; file: string; approval: boolean }[] {
  const out: { toolName: string; kinds: string[]; file: string; approval: boolean }[] = [];
  for (const abs of tsFilesIn(SKILLS_DIR)) {
    const f = path.basename(abs);
    if (f === "_template.ts") continue;
    const src = fs.readFileSync(abs, "utf8");
    const kinds = [...src.matchAll(/kind:\s*"([A-Z_]+_CARD)"/g)].map((m) => m[1]!);
    if (kinds.length === 0) continue;
    const baseAbs = f.endsWith(".helpers.ts") ? abs.replace(/\.helpers\.ts$/, ".ts") : abs;
    const baseSrc = baseAbs === abs ? src : fs.readFileSync(baseAbs, "utf8");
    const toolName = baseSrc.match(/^\s*name:\s*"([^"]+)"/m)?.[1];
    if (!toolName) throw new Error(`${path.basename(baseAbs)}: found a *_CARD persist but no defineOttoSkill name`);
    out.push({ toolName, kinds, file: f, approval: needsApproval(baseSrc) });
  }
  return out;
}

/** apps/web/lib 源码里出现的所有 *_CARD kind 字面量(persist + 查询过滤都算 ——
 *  凡在 web 动作层被引用的卡片 kind 都是活的卡片类型,须过缝 4)。 */
function webLibCardKinds(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const abs of tsFilesIn(WEB_LIB_DIR)) {
    const src = fs.readFileSync(abs, "utf8");
    for (const m of src.matchAll(/kind:\s*"([A-Z_]+_CARD)"/g)) {
      const kind = m[1]!;
      found.set(kind, [...(found.get(kind) ?? []), path.relative(REPO_ROOT, abs)]);
    }
  }
  return found;
}

describe("card seams — CARD_TOOL_NAMES (seam 5) and CARD_KINDS (seam 4) stay in lockstep", () => {
  const direct = directCardSkills();
  const webKinds = webLibCardKinds();

  it("scanner sanity: finds the known card producers (a broken regex must not green-wash)", () => {
    const names = direct.map((s) => s.toolName);
    expect(names).toContain("propose");
    expect(names).toContain("proposeResearch");
    expect(names.length).toBeGreaterThanOrEqual(4);
    expect([...webKinds.keys()]).toContain("ACTION_CARD");
    expect([...webKinds.keys()]).toContain("BUILD_CARD");
  });

  it("seam 5: every no-approval direct card skill is in CARD_TOOL_NAMES", () => {
    for (const s of direct.filter((s) => !s.approval)) {
      expect(
        CARD_TOOL_NAMES.has(s.toolName),
        `${s.file} persists ${s.kinds.join("/")} with no approval gate, but tool "${s.toolName}" is NOT in ` +
          `CARD_TOOL_NAMES (otto-stream-bridge.ts) — its card will not render until a page refresh (F23 class).`,
      ).toBe(true);
    }
  });

  it("seam 5: every port-persisted card kind has its proposing tool registered and in CARD_TOOL_NAMES", () => {
    const directKinds = new Set(direct.flatMap((s) => s.kinds));
    for (const [kind, files] of webKinds) {
      if (directKinds.has(kind)) continue; // proposed+persisted by a skills-dir skill, covered above
      const tool = PORT_CARD_TOOLS[kind];
      expect(
        tool,
        `card kind "${kind}" appears in ${files[0]} but is neither persisted by a skills-dir skill nor ` +
          `registered in PORT_CARD_TOOLS (this test) — register the proposing tool so seam 5 stays enforced.`,
      ).toBeDefined();
      if (tool) {
        expect(CARD_TOOL_NAMES.has(tool), `PORT_CARD_TOOLS maps ${kind} → "${tool}" but it is NOT in CARD_TOOL_NAMES`).toBe(true);
      }
    }
  });

  it("seam 5 reverse: no stale CARD_TOOL_NAMES entries (every entry traces to a card producer)", () => {
    const known = new Set([...direct.map((s) => s.toolName), ...Object.values(PORT_CARD_TOOLS)]);
    for (const tool of CARD_TOOL_NAMES) {
      expect(known.has(tool), `CARD_TOOL_NAMES entry "${tool}" traces to no card-producing skill (renamed/removed?)`).toBe(true);
    }
  });

  it("seam 4: every live card kind is in CARD_KINDS (or the card won't inject until refresh)", () => {
    const allKinds = new Set([...direct.flatMap((s) => s.kinds), ...webKinds.keys()]);
    for (const kind of allKinds) {
      if (WORKER_PERSISTED_KINDS.has(kind)) continue;
      expect(
        CARD_KINDS.has(kind),
        `card kind "${kind}" is persisted/used but NOT in CARD_KINDS (otto-inject-helpers.ts) — ` +
          `injectCardMessage/appendMissingCards will silently drop it; the card only appears after a page refresh. ` +
          `This is the exact seam-4 hole the 2026-07-04 adversarial review caught on RESEARCH_CARD.`,
      ).toBe(true);
    }
  });

  it("stream approval/cancel paths fully re-arm poll state, restart the poll window, and refresh after cancel", () => {
    for (const component of [OTTO_CHAT_STREAM, OTTO_CONVERSATION]) {
      const src = fs.readFileSync(component, "utf8");
      const helper = src.match(/function rearmGenerationPoll\(\) \{([\s\S]*?)\n  \}/)?.[1] ?? "";
      expect(helper).toContain("setPollGaveUp(false)");
      expect(helper).toContain("setPollTerminal(false)");
      expect(helper).toContain('setPollRound("initial")');
      // Window-restart guard (NOTE-1 regression): rearm must UNCONDITIONALLY restart the
      // poll window so a freshly-approved/retried generation gets the full MAX_POLLS
      // budget — not just the remainder of a poll already mid-flight. The three setters
      // above are no-ops (React bail-out) when already at their reset values, so the
      // reset must ride a monotonic nonce that the bounded-poll effect depends on.
      // Assert the whole wiring, not merely that a setter was called:
      //   1. rearm bumps a monotonic nonce (functional +1 → always a new value),
      //   2. the nonce is real useState-backed state, and
      //   3. it is a dependency of the effect that resets `pollCount = 0` on every run.
      expect(
        helper,
        "rearmGenerationPoll must bump a monotonic poll nonce so the poll effect re-runs",
      ).toMatch(/setPollNonce\(\s*\(?\w+\)?\s*=>\s*\w+\s*\+\s*1\s*\)/);
      expect(src).toMatch(/const \[pollNonce, setPollNonce\] = useState\(0\)/);
      const pollEffectDeps = src.match(/let pollCount = 0[\s\S]*?\},\s*\[([^\]]*)\]\)/)?.[1] ?? "";
      expect(
        pollEffectDeps,
        "the bounded-poll effect (let pollCount = 0) must list pollNonce in its deps, or the bump won't restart the window",
      ).toContain("pollNonce");
      expect((src.match(/rearmGenerationPoll\(\);/g) ?? []).length).toBeGreaterThanOrEqual(4);
      expect(src).toMatch(/onCancelled=\{[\s\S]*setCancelledJobIds[\s\S]*onBalanceRefresh\?\.\(\)[\s\S]*(pollAndInjectResults|refreshAndUpdate)/);
    }
  });
});
