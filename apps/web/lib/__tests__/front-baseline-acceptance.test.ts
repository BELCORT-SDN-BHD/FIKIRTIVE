/**
 * 前端基线(docs/specs/frontend-baseline.md §2 验收表)—— 验收↔测试的落点登记。
 *
 * 规格 §7.1 把施工切成八段;本文件属于第 ① 段(纯合并),所以这里的真测试只有
 * **FRONT-A12** —— 夹具路由的生产构建守卫。**FRONT-A13** 同属 ① 段,它的真测试已经
 * 转正,住在 `front-a13-server-adjacent.test.ts`(分支自带四处 server 邻接改动的行为
 * 测试,打真库),所以这里不再为它留占位。其余编号仍按机器闸 M3 允许的方式用
 * `it.todo` 占位:编号在测试树里有落点,但不假装已经验过。
 * 每条占位都写清它归哪一段,S5 验收时逐条转正。
 */
import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const APP = path.resolve(__dirname, "../../app");

/** 递归收集一棵目录下的全部 `page.tsx`(路径相对 `app/`)。 */
function pagesUnder(dir: string, rel = ""): string[] {
  const here = path.join(dir, rel);
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(here, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const next = rel ? path.join(rel, entry.name) : entry.name;
    if (entry.isDirectory()) out.push(...pagesUnder(dir, next));
    else if (entry.name === "page.tsx") out.push(next);
  }
  return out.sort();
}

/** 评审夹具的两棵路由树 —— 规格 §1 九问 2 把它们排除在商家入口之外。 */
const FIXTURE_ROOTS = ["product-patterns", "design-system"] as const;

describe("FRONT-A12:评审夹具路由在生产构建里不可达", () => {
  it("FRONT-A12:守卫在生产构建下 notFound(),在别的环境下什么都不做", async () => {
    const notFound = vi.fn(() => {
      throw new Error("NEXT_NOT_FOUND");
    });
    vi.resetModules();
    vi.doMock("next/navigation", () => ({ notFound }));
    const { assertReviewFixtureRoute } = await import("@/lib/review-fixture-guard");

    const original = process.env.NODE_ENV;
    // `process.env` 的属性描述符必须保持 writable/enumerable —— 只给 value 会被 Node 拒。
    const setNodeEnv = (value: string) =>
      Object.defineProperty(process.env, "NODE_ENV", {
        value,
        configurable: true,
        writable: true,
        enumerable: true,
      });
    try {
      // 生产:必须 404。夹具页渲染的是写死的数据,商家面上出现它就是「假数据冒充真相」。
      setNodeEnv("production");
      expect(() => assertReviewFixtureRoute(), "生产构建下夹具路由仍然可达").toThrow(/NEXT_NOT_FOUND/);
      expect(notFound).toHaveBeenCalledTimes(1);

      // 开发与评审构建:照常渲染,否则 Founder 的设计走查就没了。
      notFound.mockClear();
      setNodeEnv("development");
      expect(() => assertReviewFixtureRoute()).not.toThrow();
      setNodeEnv("test");
      expect(() => assertReviewFixtureRoute()).not.toThrow();
      expect(notFound).not.toHaveBeenCalled();
    } finally {
      setNodeEnv(original ?? "test");
      vi.doUnmock("next/navigation");
    }
  });

  // 普查而不是手抄清单:新开一个夹具页却忘了挂守卫,这条当场红。手抄的清单只在抄它
  // 的那一天是对的,而漏掉一页的代价是生产上多一个渲染夹具数据的商家可达页面。
  it.each(FIXTURE_ROOTS)("FRONT-A12:app/%s 下的每一个 page.tsx 都调了同一个守卫", (root) => {
    const pages = pagesUnder(APP, root);
    expect(pages.length, `app/${root} 下一个 page.tsx 都没扫到 —— 普查塌了,这条会空转通过`).toBeGreaterThan(0);
    for (const page of pages) {
      const src = readFileSync(path.join(APP, page), "utf8");
      expect(src, `app/${page} 没有 import 守卫`).toContain(
        'from "@/lib/review-fixture-guard"',
      );
      expect(src, `app/${page} import 了守卫却没调用它`).toContain("assertReviewFixtureRoute()");
    }
  });
});

describe("前端基线:后续各段的验收落点(§7.1;S5 前逐条转正)", () => {
  // ① 纯合并段自身:钱引擎 14 条在新壳上重跑。本 PR 已跑的是四道钱围栏与全量单测;
  //    A1 的完整判定要等 e2e 能在新登录旅程上签进去(见本段 PR 的「未做项」)。
  // FRONT-A1 已转正:占位改成真围栏,落在 lib/__tests__/front-a1-money-rows.test.ts。
  // 判官 2026-09-02 P1 之后它有三层(第一版只有第一层,而且被一份注释索引一个人喂饱了):
  //   ① 14 条编号各有真落点(M3 注释索引与围栏自身都不算数);
  //   ② 每条编号点名的行为测试文件在、带编号、有会跑的用例、没有 .skip;
  //   ③ 验收行点名的四处钱交付面(/admin/reconcile、账单页「Credits don't expire」、
  //      上传入口价目小字、聊天搜索成本提示)在新壳上还在**并且还挂着**。
  // 六条钱旅程的存在由同一份文件看着;浏览器那一侧由
  // e2e/journeys/07-money-surfaces-agree.spec.ts 认领。
  it.todo("FRONT-A2 §7.1⑥ — 注册/验证码/回跳/重置旅程走真实邮件,错误提示不泄露邮箱是否存在");
  // FRONT-A3 与 FRONT-A4 已**全部**转正(§7.1⑤ 三刀齐;第③刀按 Founder 2026-09-04
  // 「Meta 单源版面」裁决落地 —— ready 多来源版面不做,契约保留且不可达)。落点:
  //   lib/__tests__/home-layout.test.ts(版面定义层的规则,纯函数)
  //   lib/__tests__/home-marketing-health.test.ts(五态读模型、freshness、ready 不可达)
  //   lib/__tests__/marketing-home-view.test.tsx(五态各自的真动作、无生产者组件的变异闸)
  //   lib/__tests__/home-layout-persistence.test.ts(落库、能力闸、双向租户、连接行五态,打真库)
  //   e2e/journeys/15-home-layout-persists.spec.ts(浏览器那一侧:刷新与换浏览器)
  // A3 正文的三条读路径都双向钉住了:版面那一行、「Continue creating」的真实画布,以及
  // 这一次补上的连接状态本身(`MetaConnection` 那一行,见 home-layout-persistence.test.ts
  // 的「一家店的连接状态来自它自己那一行」一组)。
  it.todo("FRONT-A5 §7.1② — Library 历史与上传、搜索、收藏筛选全部来自服务器");
  it.todo("FRONT-A6 §7.1② — collection 增删改跨刷新成立,跨租户不可见");
  it.todo("FRONT-A7 §7.1② — Library 的 Use in canvas 落节点到当前项目与租户");
  it.todo("FRONT-A8 §7.1④ — Brand 五分区记录增改删恢复,每条显示谁改的、何时改的");
  it.todo("FRONT-A9 §7.1④ — Brand 记录进 Otto 上下文,该轮可查到");
  it.todo("FRONT-A10 §7.1③ — @ 引用选择器来自服务器,消息保存真实引用 ID");
  it.todo("FRONT-A11 §7.1⑦ — Settings/Billing 改名与余额充值走现有真能力,无契约控件不出现");
  it.todo("FRONT-A14 §7.1⑧ — Founder 登录态六面走查,差异登记规格 §5");
  it.todo("FRONT-A15 §7.1⑨ — Canvas 与 Create 的控件集合与设计夹具逐控件一致(自动对照;2026-09-03 §7 修订新增)");
});
