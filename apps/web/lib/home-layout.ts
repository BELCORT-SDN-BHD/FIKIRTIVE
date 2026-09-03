/**
 * Home 版面的**唯一定义层** —— 纯函数,零 I/O(规格 docs/specs/frontend-baseline.md §7.3⑤)。
 *
 * 规格要的是「一份版面定义单源,客户端只渲染」。所以「这一刻 Home 上该有哪几块、按什么顺序」
 * 这个问题在整个仓库里只有这一个答案的产地:服务端读一行 `OrgHomeLayout`,交给
 * {@link resolveHomeComponents} 算出一个有序数组,客户端拿到数组照着画。客户端不再自己判断
 * 「这块该不该出现」—— 那正是评审原型里那份 per-goal 本地 state 做的事,而本地 state 一刷新就没了。
 *
 * ── 两条规则,都不是整洁,都是「不许说大话」 ─────────────────────────────────────
 *
 * ① **没有真实生产者的组件不出现**(Founder 2026-09-03 裁决九;规格 §7.3⑤ 逐字:
 *    「没有真实生产者的组件不出现,不摆空卡、不摆占位数字」)。设计夹具那 8 块是拿
 *    fixture 画的;生产上今天只有一块有真数据源。{@link HOME_COMPONENT_PRODUCER} 是这件事的
 *    单一来源 —— 渲染按它过滤、Customize 面板按它列清单、围栏测试按它对账,三处读同一份表,
 *    所以「设计有、生产暂不显示」不可能在某一处偷偷变成「显示一张空卡」。
 *
 * ② **顺序与勾选是商家的话,不是我们的**。保存的那一行记两件事:
 *    `componentIds`(保存那一刻看得见的顺序)与 `hiddenIds`(明确取消勾选的)。
 *    分成两列是为了让「以后逐个点亮的组件」有确定归宿(§7.3⑤「ready 多源版面随生产者
 *    逐个点亮」):一个明天才有生产者的组件,今天既不在 componentIds 也不在 hiddenIds 里,
 *    到时候按推荐模板补到末尾出现 —— 而不是被当成「商家关掉过」永远不再露面。
 *
 * ── 与评审原型的一处已知分歧(登记在 PR,不是漏做) ────────────────────────────
 * 评审原型 `FounderHomeReference` 给**每个 business goal** 各存一份顺序(interaction mini-spec
 * 第 4 条)。规格 §1 九问 4 与 §7.3⑤ 都把落库口径定成「org 级一行」,所以生产上一个工作区
 * 只有一份顺序,三个 goal 共用。goal 仍然决定**没保存过时**的推荐模板(见下面的 recommended)。
 */

import {
  HOME_COMPONENTS,
  recommendedHome,
  type HomeComponentId,
  type HomeGoal,
} from "@/design-system/patterns/founder-home/model";

/**
 * 每一块 Home 组件今天在**生产**上有没有真实数据源。
 *
 * `null` = 有,照设计渲染。字符串 = 没有,这一块不渲染,而这个字符串就是不渲染的理由
 * (PR 的「设计有、生产暂不显示」表逐行抄它,S5 验收时逐行对)。
 *
 * 加一块的门槛是**指得出生产者**:一个服务端函数,读商家自己的真数据,不是 fixture、
 * 不是常量、不是「先摆着以后接」。接上了就把这里改成 null,推荐模板自然把它带出来。
 */
export const HOME_COMPONENT_PRODUCER: Record<HomeComponentId, string | null> = {
  // 真实生产者:`getAnalytics()`(商家自己的 Meta 广告账号)→ `marketingHealthFromAnalytics()`。
  // 五态(未连接/需重连/数据不足/partial/读不出来)全部来自服务器,没有一态是编的。
  "marketing-health": null,
  // 设计要的是「广告回报率 + 总广告花费」两个数并排。总花费有真生产者(buildKpis 的 Spend),
  // 广告回报率没有:今天没有任何函数把它算成一个 org 级的数,而跨币种的 ROAS 更不是一个
  // 可以随手相加的量(analytics-view.ts 的 moneyBucketKey 明写为什么不许跨币种相加)。
  // 只画一半 = 画一张缺了主角的卡,所以整块不出现,等 ROAS 生产者落地。
  efficiency: "没有 ROAS(广告回报率)生产者;跨币种不许合并成一个数(lib/analytics-view.ts moneyBucketKey)",
  // 设计要的是一串「用商家自己的话说的重要变化」。今天只有 `buildInsightText` 出的一句话,
  // 而且它已经出现在 marketing-health 里;把同一句复制成一张「What changed」列表,
  // 是把一条线索排版成一份清单。
  "what-changed": "没有变化清单生产者;今天只有一句 insight,已在 Marketing health 里出现",
  // 设计要的是逐个 campaign / creative 的表现行。Meta 拉的是账号级汇总(fetchOwnerInsights)
  // 与日序列,没有逐条素材的行。
  "top-performers": "没有逐 campaign／creative 的生产者;Meta 只拉账号级汇总与日序列",
  // 设计要的是 Otto 备好的一条下一步。规格 §3「不做」明写 Otto 页面上下文读取器归 Otto 引擎;
  // 在它落地之前,这块只能画一句我们编的建议。
  "recommended-action": "归 Otto 引擎(规格 §3「不做 Otto 页面上下文读取器」);在此之前不显示假建议",
  // 设计要的是各渠道对营收的贡献比。今天只连得上 Meta 一家,「贡献」必然是 100%,
  // 那不是一个发现,是一句同义反复。
  "channel-contribution": "只有 Meta 一个来源,贡献比恒为 100%,不是一个发现",
  // 两块 Operations 都读得到 ScheduledPost,但 Schedule 在 Beta 停用
  // (packages/core/src/navigation.ts:「Schedule 在 Beta 停用」,#850 裁决),
  // 商家今天没有任何一条造出待审内容的路。摆一块永远「All caught up」的卡,
  // 说的是一件商家做不到的事。
  "waiting-approval": "Schedule／审批在 Beta 停用(#850),商家没有造出待审内容的路",
  "publishing-next": "Schedule／发布在 Beta 停用(#850),商家没有排期可发",
};

const HOME_COMPONENT_IDS = new Set<string>(HOME_COMPONENTS.map((component) => component.id));

export function isHomeComponentId(value: unknown): value is HomeComponentId {
  return typeof value === "string" && HOME_COMPONENT_IDS.has(value);
}

/** 今天在生产上有真实数据源的组件,按设计模型的声明顺序。 */
export function availableHomeComponents(): HomeComponentId[] {
  return HOME_COMPONENTS.filter((component) => HOME_COMPONENT_PRODUCER[component.id] === null).map(
    (component) => component.id,
  );
}

/**
 * 一行 `OrgHomeLayout` 读出来的样子。`null` = 这个工作区从没保存过版面。
 *
 * 刻意**不带**「谁改、何时改」:那两列存在库里是给审计用的,而设计的 Customize 面板上
 * 没有这句话 —— 主干自加、设计没有的文案不进生产界面(Founder 2026-09-03 规则③)。
 */
export type SavedHomeLayout = {
  readonly componentIds: readonly string[];
  readonly hiddenIds: readonly string[];
};

/**
 * 这一刻 Home 上该有哪几块、按什么顺序 —— 整个产品对这个问题的唯一答案。
 *
 * 没保存过 → 该 goal 的推荐模板(只留有生产者的)。
 * 保存过   → 保存的顺序(丢掉未知 id、没生产者的、以及被明确藏起来的),后面补上
 *            推荐模板里「保存那天还不存在、今天有了、且没被藏起来」的新组件。
 */
export function resolveHomeComponents(input: {
  goal: HomeGoal;
  saved: SavedHomeLayout | null;
}): HomeComponentId[] {
  const available = new Set(availableHomeComponents());
  const recommended = recommendedHome(input.goal).filter((id) => available.has(id));

  if (!input.saved) return [...recommended];

  const hidden = new Set(input.saved.hiddenIds.filter(isHomeComponentId));
  const kept: HomeComponentId[] = [];
  for (const id of input.saved.componentIds) {
    if (!isHomeComponentId(id)) continue; // 未知 id(改名/退役的组件)直接丢弃
    if (!available.has(id) || hidden.has(id) || kept.includes(id)) continue;
    kept.push(id);
  }

  const mentioned = new Set<HomeComponentId>([...kept, ...hidden]);
  const appeared = recommended.filter((id) => !mentioned.has(id));
  return [...kept, ...appeared];
}

/**
 * 把 Customize 面板按 Save 时的两件事,翻成要落库的两列。
 *
 * `offered` 必须是面板**真的列出来过**的那一串(= {@link availableHomeComponents}):
 * 「没勾 = 藏起来」只有在商家真的看见过那一格时才成立。没列出来的组件既不进
 * componentIds 也不进 hiddenIds —— 它们的归宿由上面的 resolve 决定。
 */
export function homeLayoutWrite(input: {
  offered: readonly HomeComponentId[];
  selected: readonly HomeComponentId[];
}): { componentIds: HomeComponentId[]; hiddenIds: HomeComponentId[] } {
  const offered = new Set(input.offered);
  const componentIds: HomeComponentId[] = [];
  for (const id of input.selected) {
    if (offered.has(id) && !componentIds.includes(id)) componentIds.push(id);
  }
  const selected = new Set(componentIds);
  return {
    componentIds,
    hiddenIds: input.offered.filter((id) => !selected.has(id)),
  };
}
