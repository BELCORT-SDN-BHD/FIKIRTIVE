# Otto 研究 · S1(search 端口 + 缓存分页,$0)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。实现 = Opus;每 task review;S 块整支 money review 在 S5(本 S1 全 $0 但仍逐 task 审)。
> spec = `docs/superpowers/specs/2026-07-03-otto-research-design.md` §2/§3/§7.1。蓝本引用式(同 G plan):凡与既有模式同形处照抄其模式与断言强度。

**Goal:** 接通 `ctx.research.search`(Tavily 主 + Brave 备,可换端口、fallback、瘦结果)+ 页面缓存/按需分页(Nous 省 49× 的那招)+ 新 `searchWeb` skill(17→18)+ 现有 `researchWeb` 升级(缓存+分页)。全 $0(免费档 API + LLM tokens 已随轮计量)。

**Keys:** dev 已就位(主 checkout `apps/web/.env.local`:`TAVILY_API_KEY` / `BRAVE_SEARCH_API_KEY`,2026-07-03 实测 HTTP 200)。**worktree 无 env** —— 单测一律 mock fetch,不打真 API;真机验证在主 checkout 跑。

## Global Constraints

- **$0**:不碰任何钱原语(无 GenJob/reserve/settle);外部**读**不审批(3 字段 gate 既有规则)。
- **零硬编码 provider**:适配器在共享包(worker S3 也要用),统一接口;Tavily 失败/未配 → Brave fallback;都没配 → 端口不注入,skill 返回友好 `{error}`(fail-closed,不崩)。
- **瘦结果**:search 只回 `{title, url, snippet}[]`(≤8 条),绝不把整页塞给模型;正文靠 readPage 按需分页。
- **缓存全局共享**(公开网页正文,无租户数据):`WebPageCache` 按 urlHash 唯一,TTL 7 天;**加性 migration**(纯新表)。
- **SSRF 纪律沿用**:所有抓取仍走 `assertPublicHttpUrlResolved` 系(fetch-extract 既有);缓存不绕过校验。
- secrets 纪律:key 只经 env 读,**任何日志/错误信息不得含 key**;测试 fixture 不用真 key。
- 每 task:vitest 绿 + `pnpm -r typecheck` + **`pnpm --filter @fikirtive/web build` EXIT 0**(动 client 相关时)。

---

### Task 1: 共享 search 适配器(packages/core)

**Files:** Create `packages/core/src/websearch.ts` + `websearch.test.ts`;Modify `packages/core/src/index.ts`(导出)。

**语义(测试逐条锁):**
1. 类型:`export type WebSearchResult = { title: string; url: string; snippet: string }`;`export type WebSearchFn = (query: string) => Promise<WebSearchResult[]>`。
2. `tavilySearch(apiKey)(query)`:POST api.tavily.com/search(Bearer,`{query, max_results: 8}`),映射 `results[].{title,url,content→snippet}`;snippet 截 ≤400 字符。非 200 → throw(带状态码,**不带 key**)。
3. `braveSearch(apiKey)(query)`:GET api.search.brave.com/res/v1/web/search(`X-Subscription-Token`,q+count=8),映射 `web.results[].{title,url,description→snippet}`,同样截断。
4. `searchWithFallback(primary, fallback?)`:primary 抛错且有 fallback → 试 fallback;都败 → throw 聚合信息(不含 key)。空结果不算失败(如实返回 `[]`)。
5. 全部注入式 `fetch`(参数默认 globalThis.fetch)→ 单测 mock 无网络;每请求 8s timeout(AbortSignal)。
6. 测试:两适配器映射/截断/非200/超时;fallback 三态(primary 成功不碰 fallback、primary 败切换、双败聚合);错误串不含 key(正则断言)。

**Steps:** TDD 红→绿 → `pnpm --filter @fikirtive/core exec vitest run src/websearch.test.ts` → core typecheck+build → commit `feat(core): web search adapters — tavily + brave + fallback (thin results, injectable fetch)`。

---

### Task 2: `WebPageCache` 表 + 缓存抓取 + 分页

**Files:** Modify `packages/db/prisma/schema.prisma`(新模型)+ Create migration `2026xxxx_web_page_cache/migration.sql`(加性 CREATE TABLE,镜像既有 migration 风格);Create `apps/web/lib/web-page-cache.ts` + `__tests__/web-page-cache.test.ts`。

**语义:**
1. Prisma 模型:`WebPageCache { id String @id, urlHash String @unique, url String, title String, text String, fetchedAt DateTime }`(`@@map` 风格照既有表;text 存干净正文全文)。
2. `readPageCached(url, page = 1)`(纯服务端 helper,注入 prisma+fetcher):
   - `urlHash = sha256(规范化 url)`;命中且 `fetchedAt` 距今 < 7 天 → 用缓存;否则走既有 `fetchAndExtract`(SSRF 校验在其内)→ upsert 缓存。
   - 分页:text 按 `PAGE_CHARS = 4000` 切;返回 `{ url, title, page, totalPages, text }`;page 越界 → 空 text + 正确 totalPages(不 throw)。
   - fetch 失败且有过期缓存 → 降级用过期缓存(标记 `stale: true`);无缓存 → throw。
3. 测试(mock prisma+fetcher):命中新鲜缓存不抓网;过期重抓+upsert;分页切割/越界;降级 stale;sha 规范化(同 url 带尾斜杠/query 顺序——**只做小写 host + 去 fragment 的保守规范化**,不激进)。

**Steps:** TDD → migration 加性核对(只 CREATE TABLE)→ `pnpm --filter @fikirtive/db build` + prisma generate → 测试绿 → commit `feat(db,web): WebPageCache + cached page reads with on-demand paging (Nous-style)`。

---

### Task 3: 端口接线 + `searchWeb` skill + `researchWeb` 升级(17→18)

**Files:** Modify `packages/otto/src/context.ts`(research 端口形状:`search?: WebSearchFn` 已声明,补 `readPage?(url, page?)`)、`apps/web/lib/otto-actions.ts`(buildOttoContext 注入:env 读 key → `searchWithFallback(tavilySearch(k1), k2 ? braveSearch(k2) : undefined)`;`readPage: readPageCached`)、`packages/otto/src/skills/research-web.ts`(输入加 `page?: z.number().int().min(1).optional()`,走 `ctx.research.readPage`,回 `{title, page, totalPages, text}`)、Create `packages/otto/src/skills/search-web.ts`(+test)、`registry.ts`(17→18)+ `registry.test.ts` + `instructions.ts`(研究一节:先 searchWeb 拿瘦结果 → 挑 1-3 个 URL researchWeb 按页读,**不要一次读全部结果**;华语注释英文 prose,反引号转义)+ instructions.test + CATALOG regen。

**语义:**
1. `searchWeb` skill:`defineOttoSkill({ cost:"free", effect:"read", reach:"external", parameters: z.object({ query: z.string().trim().min(2).max(200) }) })` → `needsApproval === false`(测试断言);无端口(key 未配)→ 友好 `{error: "Web search isn't configured yet."}`;结果原样瘦透传(≤8 条)。
2. `researchWeb` 升级向后兼容:不传 page = 第 1 页;未接 readPage 端口时回退旧 fetchUrl 行为(平滑过渡,测试锁)。
3. registry 排序名单更新(18 名,照 F1 先例);CATALOG `pnpm --filter @fikirtive/otto run catalog`。
4. 测试:gate 断言、无端口 error、瘦透传、researchWeb 分页/回退、instructions 锚定断言(/searchWeb/、分页提示 token)。

**Steps:** TDD → otto 全套 + web 全套(允许失败仅既有环境族)→ `pnpm -r typecheck` + **web build EXIT 0** → commit `feat(otto): searchWeb skill + cached paged researchWeb — research port wired (17→18, \$0)`。

---

### Task 4(收尾):S1 真机冒烟(主 checkout,可选交创始人)

- [ ] 主 checkout(有 env)跑 dev,Otto 对话试:「search the web for 2026 marketing trends and summarize one page」→ 观察 searchWeb→researchWeb 分页链路 + WebPageCache 落表。无真机条件则记录为 founder 验收项。

---

## Self-Review

Spec §7.1 覆盖:适配器可换+fallback ✅ T1;缓存分页 ✅ T2;searchWeb 升级 ✅ T3;配额守卫按 spec 归 S3(注记,不在 S1)。类型:`WebSearchResult/WebSearchFn` T1 定义、T3 端口消费;`readPageCached` T2 定义、T3 注入。Placeholder:蓝本引用式,硬语义逐条列出且要求测试锁。Money:$0,无钱原语;外部读不审批为既有规则。

## 相关文件

端口:`packages/otto/src/context.ts:80-88`;注入:`apps/web/lib/otto-actions.ts:177-180`;抽取:`apps/web/lib/fetch-extract.ts`(SSRF);skill 模板:`packages/otto/src/skills/research-web.ts` + `_template.ts` + AGENTS.md;migration 先例:`packages/db/prisma/migrations/`(加性表);registry/CATALOG 先例:F1。
