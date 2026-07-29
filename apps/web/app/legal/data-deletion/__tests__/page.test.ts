/**
 * /legal/data-deletion 状态页(#489):回调 url 携带 outcome=deleted|none,页面必须
 * 如实区分「已删除连接」与「未找到关联数据」,且对 none / 未知 outcome 绝不渲染
 * 「已删除」确认语义。页面不查库,直接以 props 渲染即可覆盖。
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DataDeletionPage from "../page";

async function render(params: { code?: string; outcome?: string }): Promise<string> {
  return renderToStaticMarkup(await DataDeletionPage({ searchParams: Promise.resolve(params) }));
}

const DELETED_CLAIM = "was found and deleted";

describe("/legal/data-deletion page (#489 outcome honesty)", () => {
  it("outcome=deleted → states the connection was deleted", async () => {
    const html = await render({ code: "code-1", outcome: "deleted" });
    expect(html).toContain("code-1");
    expect(html).toContain(DELETED_CLAIM);
  });

  it("outcome=none → states no associated data was found, NEVER a deletion confirmation", async () => {
    const html = await render({ code: "code-2", outcome: "none" });
    expect(html).toContain("code-2");
    expect(html).toContain("no stored Meta connection");
    expect(html).toContain("nothing was deleted");
    expect(html).toContain("not a confirmation that any data was deleted");
    expect(html).not.toContain(DELETED_CLAIM);
  });

  it("legacy link (code without outcome) → generic explanation, no deleted claim", async () => {
    const html = await render({ code: "code-3" });
    expect(html).toContain("code-3");
    expect(html).not.toContain(DELETED_CLAIM);
  });

  it("forged/unknown outcome value → falls back to the generic copy, no deleted claim", async () => {
    const html = await render({ code: "code-4", outcome: "definitely-deleted" });
    expect(html).not.toContain(DELETED_CLAIM);
  });

  it("no code → informational page only", async () => {
    const html = await render({});
    expect(html).toContain("How Meta deletion requests work here");
    expect(html).not.toContain(DELETED_CLAIM);
  });
});
