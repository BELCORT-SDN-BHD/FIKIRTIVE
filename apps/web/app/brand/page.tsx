import { redirect } from "next/navigation";
import { SHELL_ROUTES } from "@fikirtive/core/navigation";
import { requireOwner } from "@/lib/auth-guard";
import { getOrCreateDefaultProject } from "@/lib/actions";
import { getProjects } from "@/lib/data";
import { listMemory, type MemoryRow } from "@/lib/memory-actions";
import { R22OttoIQView } from "@/components/otto-iq/R22OttoIQView";

/**
 * Brand —— 换壳(Wave 2)的 W2-2,规格书 `docs/specs/wave2-shell.md` §4.4。
 *
 * 这一票只做两件事:**取消嵌套**与**说实话**。
 *
 * ① 取消嵌套:今天商家要看自己的品牌资料,得先落在 `/otto` 这个板块里,再从第二条导轨点
 *    「Brand memory」,地址栏一路写着 `/otto?view=memory` —— 刷新一次还在,但那是 Otto 的
 *    地址,不是商家的。这里把同一份内容摆成它自己的一扇门 `/brand`,组件一行没搬家:
 *    `OttoMemory` 背后仍是 `Memory` 与 `BrandRecord` 两张真有读写的表,零 schema 改动、
 *    零迁移、零钱路与租户改动。
 *
 * ② 说实话:那句诚实说明写在 `OttoMemory` 里(§4.4 的原话),因为旧的 `/otto?view=memory`
 *    今天还开着 —— 同一件事不许只在一扇门后面说。
 *
 * **Stack A 纪律**(规格书 §6.3):这一票只**新增**一条路由。`packages/core` 的导航权威
 * 一个字不动,`MERCHANT_NAV` 里还没有 Brand 这一格,所以今天只有直接输地址才到得了这里,
 * 旧壳的行为一点没变。导航指过来是切换总票(W2-11)的事,那一票同时把
 * `/otto?view=memory` 变成 307 到这里。
 *
 * **URL 形状**:agency 多品牌是真实的未来场景,所以门牌是 `/brand` 而不是 `/brand/me` ——
 * 它长得出 `/brand/[brandId]` 而不必改名。代码里**不预埋**任何 brand id 参数(§1.2)。
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Brand · Fikirtive" };

export default async function BrandPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; tab?: string; fixture?: string; state?: string }>;
}) {
  const sp = await searchParams;
  const panes = new Set(["hub", "voice", "audiences", "sources", "style", "visual"]);
  const initialPane = panes.has(sp.tab ?? "") ? sp.tab as "voice" | "audiences" | "sources" | "style" | "visual" : "hub";
  if (process.env.NODE_ENV !== "production" && sp.fixture === "r22") {
    const fixtureState = sp.state === "loading" || sp.state === "empty" || sp.state === "error" || sp.state === "permission" || sp.state === "unknown" ? sp.state : "ready";
    const fixtureDate = new Date("2026-08-24T12:00:00.000Z");
    const fixtureMemory: MemoryRow[] = [
      { id: "fixture-voice", category: "voice", content: "Everyday voice: Warm, direct and specific about the craft.", source: "user", pinned: true, updatedAt: fixtureDate },
      { id: "fixture-audience-1", category: "audience", content: "Weekend gift buyers: Thoughtful local gifts for family visits.", source: "user", pinned: true, updatedAt: fixtureDate },
      { id: "fixture-audience-2", category: "audience", content: "Returning customers: People restocking scents they already know.", source: "user", pinned: true, updatedAt: fixtureDate },
      { id: "fixture-source-1", category: "source", content: "Brand story: Batik House origin and local craft notes.", source: "user", pinned: true, updatedAt: fixtureDate },
      { id: "fixture-source-2", category: "knowledge", content: "Candle care: Trim the wick to 5 mm before lighting.", source: "user", pinned: true, updatedAt: fixtureDate },
      { id: "fixture-style-1", category: "style", content: "Approved language: Describe materials and process plainly.", source: "user", pinned: true, updatedAt: fixtureDate },
      { id: "fixture-style-2", category: "do not say", content: "Do not say: Never promise health or therapeutic outcomes.", source: "user", pinned: true, updatedAt: fixtureDate },
      { id: "fixture-visual", category: "visual", content: "Raya visual direction: Teal batik, warm gold and calm natural light.", source: "user", pinned: true, updatedAt: fixtureDate },
    ];
    return <R22OttoIQView initialMemory={fixtureState === "empty" ? [] : fixtureMemory} initialPane={initialPane} fixture fixtureState={fixtureState} />;
  }

  const owner = await requireOwner();
  if ("error" in owner) redirect("/login");
  const ensured = await getOrCreateDefaultProject();
  if ("error" in ensured) redirect("/login");
  const projects = await getProjects(owner.ownerId);
  const requested = sp.project ? projects.find((project) => project.id === sp.project) : undefined;
  const projectId = requested?.id ?? projects[0]?.id ?? ensured.id;
  if (sp.project && !requested) {
    const corrected = new URLSearchParams({ project: projectId });
    if (sp.tab) corrected.set("tab", sp.tab);
    redirect(`${SHELL_ROUTES.brand}?${corrected.toString()}`);
  }
  const memory = await listMemory(owner.ownerId);
  return <R22OttoIQView initialMemory={memory} initialPane={initialPane} />;
}
