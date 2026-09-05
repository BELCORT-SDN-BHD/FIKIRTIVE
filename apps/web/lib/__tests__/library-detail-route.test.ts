/**
 * library-detail-route —— `/library/<id>` 是一条**真地址**(清单 B3 / P1-007;
 * 前端基线规格 `docs/specs/frontend-baseline.md` §5 2026-09-05 行;验收行 FRONT-A14)。
 *
 * 改前一件素材的详情只活在 `?asset=…&project=…` 两个查询参数里:地址读不出「现在开着的是
 * 哪一件」,贴给别人会带上一个多余的 `project`。已批准的 Library pattern §4 要的是
 * route-backed side panel —— 「可 deep-link,也可关闭返回原 grid state」。
 *
 * 这份文件钉的是**那条路由的接线**,不是它画出来的像素(像素那一半在 `LibraryView` 与
 * `DetailPanel` 各自的挂载测试里):
 *   ① 路径段真的变成详情面要打开的那一件(`initialAsset.generationId`),`projectId` 留空 ——
 *      归属由服务端按 id 重新解析,不靠地址里带一个可伪造的值;
 *   ② 详情路由画的就是 `/library` 那一页(同一个 `LibraryView`,同一组 props),不是复制的
 *      第二份实现;`?view=` 这类同行参数照样带过去;
 *   ③ 回收站在地址里(`?show=trash` ⇒ `initialShow`)—— 刷新与「贴给别人」都回得到同一堆
 *      东西,不是只活在内存里的一个模式(FRONT-A5)。
 *
 * 假件只挂在**数据与守卫**那一层(`requireOwner` / 三个读),`LibraryView` 换成一个记录 props
 * 的存根 —— 要证的是「谁把什么交给了它」,所以那一层必须能读得到。
 *
 * 变异自查(逐一实做,做完还原,红→绿):
 *   · 把 `[id]/page.tsx` 的 `{ ...rest, asset: id }` 改成 `{ ...rest }` ⇒ ① 红;
 *   · 把它改成自己 `return <LibraryView …/>` 的第二份实现(不再调 `LibraryPage`)⇒ ② 红;
 *   · 把 `page.tsx` 的 `initialShow` 那一行去掉 ⇒ ③ 红。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  getProjects: vi.fn(),
  getGenerationHistory: vi.fn(),
  getLibraryElements: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/auth-guard", () => ({ requireOwner: mocks.requireOwner }));
vi.mock("@/lib/data", () => ({ getProjects: mocks.getProjects }));
vi.mock("@/lib/library-actions", () => ({ getGenerationHistory: mocks.getGenerationHistory }));
vi.mock("@/lib/library-elements", () => ({ getLibraryElements: mocks.getLibraryElements }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
// 存根:这一层只要拿到 props 就够了 —— 真组件在 jsdom 里的行为由它自己的挂载测试负责。
const LibraryViewStub = () => null;
vi.mock("@/components/library/LibraryView", () => ({ LibraryView: LibraryViewStub }));

const { default: LibraryAssetPage } = await import("@/app/library/[id]/page");
const { default: LibraryPage } = await import("@/app/library/page");

type RenderedProps = {
  initialView: string;
  initialAsset?: { generationId: string; projectId: string };
  initialShow?: string;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireOwner.mockResolvedValue({ ownerId: "org_1" });
  mocks.getProjects.mockResolvedValue([{ id: "prj_1", name: "Hari Raya gifting" }]);
  mocks.getGenerationHistory.mockResolvedValue({ items: [], nextCursor: null });
  mocks.getLibraryElements.mockResolvedValue([]);
});

async function propsOfDetailRoute(
  id: string,
  searchParams: Record<string, string> = {},
): Promise<RenderedProps> {
  const element = await LibraryAssetPage({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve(searchParams),
  });
  expect((element as { type: unknown }).type, "详情路由画的不是 /library 那一页的 LibraryView")
    .toBe(LibraryViewStub);
  return (element as unknown as { props: RenderedProps }).props;
}

describe("FRONT-A14 `/library/<id>` 是一条真地址", () => {
  it("FRONT-A14 路径段就是要打开的那一件 —— projectId 留空,归属由服务端按 id 重新解析", async () => {
    const props = await propsOfDetailRoute("gen_abc");
    expect(props.initialAsset).toEqual({ generationId: "gen_abc", projectId: "" });
  });

  it("FRONT-A14 详情路由画的就是 /library 那一页,同行参数照样带过去", async () => {
    const props = await propsOfDetailRoute("gen_abc", { view: "uploads" });
    expect(props.initialView).toBe("uploads");
    // 同一页、同一组读:Uploads 那一格的首屏仍是一次来源约束的查询,不是第二份实现。
    expect(mocks.getGenerationHistory).toHaveBeenCalledWith(
      expect.objectContaining({ sources: ["upload"] }),
    );
  });

  it("FRONT-A14 老链接 `?asset=` 仍然认 —— 换地址形状没有把已经发出去的链接弄坏", async () => {
    const element = await LibraryPage({
      searchParams: Promise.resolve({ asset: "gen_old", project: "prj_1" }),
    });
    const props = (element as unknown as { props: RenderedProps }).props;
    expect(props.initialAsset).toEqual({ generationId: "gen_old", projectId: "prj_1" });
  });
});

describe("FRONT-A5 回收站也在地址里", () => {
  it("FRONT-A5 `?show=trash` 进 initialShow —— 刷新与贴给别人都回得到同一堆东西", async () => {
    const element = await LibraryPage({ searchParams: Promise.resolve({ show: "trash" }) });
    expect((element as unknown as { props: RenderedProps }).props.initialShow).toBe("trash");
  });

  it("FRONT-A5 没写 `show` 就是 In library —— 别的值也一样,不认识的一律不当回收站", async () => {
    const plain = await LibraryPage({ searchParams: Promise.resolve({}) });
    expect((plain as unknown as { props: RenderedProps }).props.initialShow).toBeUndefined();
    const junk = await LibraryPage({ searchParams: Promise.resolve({ show: "everything" }) });
    expect((junk as unknown as { props: RenderedProps }).props.initialShow).toBeUndefined();
  });
});
