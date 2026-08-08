/**
 * #586 / #571 G1 — Otto 回复的富文本渲染。
 *
 * 两组断言:
 *  ① 渲染:`**bold**` 出 <strong> 而不是字面星号,列表出 <ul>/<li>,表格出 <table>,代码出 <pre>。
 *  ② 边界:raw HTML 不成 DOM、javascript:/相对链接不成锚、外链带安全属性、markdown 图片不发请求。
 *
 * 并且四个渲染出口各有一条守卫,但**强度分两档,别当成同一件事**:
 *  · TextPart 与 ResearchReport 是真渲染断言 —— 出口被改回裸文本就红。
 *  · OttoConversation 与 OttoMemory 是**接线检查(wiring check)**:读源码字符串,只证明这两个
 *    文件仍然引用 OttoMarkdown,**不验证渲染行为**(它们牵入 server actions,整树渲染不动)。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/storage", () => ({
  storage: { url: () => "https://example.test/asset" },
  kindOf: () => "image",
}));

import { OttoMarkdown, safeHref } from "@/components/otto/parts/OttoMarkdown";
import { TextPart } from "@/components/otto/parts/TextPart";
import { ResearchReport } from "@/components/otto/ResearchReport";

function md(text: string, streaming?: boolean): string {
  return renderToStaticMarkup(createElement(OttoMarkdown, { text, streaming }));
}

/** Every tag name actually present as MARKUP (escaped text like `&lt;script&gt;` is not a
 *  tag and never appears here) — lets the XSS assertions be about elements, not substrings. */
function tagsIn(markup: string): string[] {
  return [...markup.matchAll(/<(\/?[a-z][a-z0-9]*)/gi)].map((m) => m[1].toLowerCase());
}

describe("OttoMarkdown — rendering (#571 G1: merchants saw literal ** in production)", () => {
  it("renders **bold** as <strong>, not as literal asterisks", () => {
    const markup = md("**Credits left:** 13.2");

    expect(markup).toContain("<strong>Credits left:</strong>");
    expect(markup).not.toContain("**");
  });

  it("renders a dash list as <ul>/<li>", () => {
    const markup = md("Here's what I used:\n\n- 1.0 on the wallet image\n- 1.6 on the video");

    expect(markup).toContain("<ul>");
    expect(markup).toContain("<li>1.0 on the wallet image</li>");
    expect(markup).toContain("<li>1.6 on the video</li>");
    // The literal bullet characters must be gone from the text.
    expect(markup).not.toContain("- 1.0 on the wallet image");
  });

  it("renders an ordered list, italics and inline code", () => {
    const markup = md("1. first\n2. second\n\n*soft* and `seedance-2-mini`");

    expect(markup).toContain("<ol>");
    expect(markup).toContain("<em>soft</em>");
    expect(markup).toContain("<code>seedance-2-mini</code>");
  });

  it("renders a fenced code block as <pre><code>", () => {
    const markup = md("```\nnpm run build\n```");

    expect(markup).toContain("<pre>");
    expect(markup).toContain("<code>");
    expect(markup).toContain("npm run build");
    expect(markup).not.toContain("```");
  });

  it("renders a GFM table inside its own horizontal-scroll box (remark-gfm)", () => {
    const markup = md("| Model | Cost |\n| --- | --- |\n| Seedance | 12 |");

    expect(markup).toContain('class="otto-prose-scroll"');
    expect(markup).toContain("<table>");
    expect(markup).toContain("<th>Model</th>");
    expect(markup).toContain("<td>Seedance</td>");
    expect(markup).not.toContain("| Model | Cost |");
  });

  it("renders GFM strikethrough (proves remark-gfm is wired, not just CommonMark)", () => {
    expect(md("~~10 seconds~~")).toContain("<del>10 seconds</del>");
  });

  it("keeps paragraph breaks — every block is a real element, never pre-wrap text", () => {
    const markup = md("First line.\n\nSecond line.");

    expect(markup).toContain("<p>First line.</p>");
    expect(markup).toContain("<p>Second line.</p>");
  });

  it("keeps SINGLE newlines as line breaks (remark-breaks) — the pre-wrap regression guard", () => {
    // Without remark-breaks markdown folds a lone \n into a space, so the real production
    // reply below would collapse onto one line — worse than the pre-wrap it replaces.
    const markup = md("**Credits left:** 13.2\nHere's what I can tell you:");

    expect(markup).toContain("<br/>");
    expect(markup).toContain("<strong>Credits left:</strong>");
  });
});

describe("OttoMarkdown — streaming (no flicker, no split paragraph)", () => {
  it("marks the container while streaming so the caret rides the last block as ::after", () => {
    // The caret is CSS (.otto-prose[data-streaming="true"] > :last-child::after), NOT a
    // sibling node — a sibling <span> after a block-level <p> would drop to its own line
    // and visually split the final paragraph.
    const markup = md("Working on it", true);

    expect(markup).toContain('data-streaming="true"');
    expect(markup).not.toContain("▋");
  });

  it("omits the streaming marker once the turn has settled", () => {
    expect(md("Done.")).not.toContain("data-streaming");
  });

  it("renders every prefix of a streamed reply without throwing or emitting raw markup", () => {
    // Mid-stream the text is arbitrarily truncated ("**Credits le"). Each prefix must
    // render; unterminated emphasis simply stays literal until its closer arrives.
    const full = "**Credits left:** 13.2\n\n- wallet image\n- video";
    for (let i = 1; i <= full.length; i += 1) {
      const markup = md(full.slice(0, i), true);
      expect(markup).toContain('class="otto-prose"');
    }

    // Half-open emphasis is literal; the completed one is bold. That transition is the
    // only visible change, and it is a subtree swap — not a re-mount of the bubble.
    expect(md("**Credits le", true)).toContain("**Credits le");
    expect(md("**Credits left:**", true)).toContain("<strong>Credits left:</strong>");
  });
});

describe("OttoMarkdown — XSS / prompt-injection boundary", () => {
  it("never turns raw HTML into DOM (no rehype-raw) — it is escaped to visible text", () => {
    const markup = md('Hello <script>alert(1)</script> and <img src=x onerror="alert(2)">');

    // No element node originates from the raw HTML: the only tags in the output are the
    // ones OttoMarkdown itself emits (<div class="otto-prose"> and <p>).
    expect(tagsIn(markup)).toEqual(["div", "p", "/p", "/div"]);
    expect(markup).not.toContain("<script");
    expect(markup).not.toContain("<img");
    // …and the dangerous attribute only survives as escaped TEXT, never as an attribute:
    // fail-visible, not fail-silent — the merchant still sees what Otto said.
    expect(markup).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(markup).toContain("onerror=&quot;alert(2)&quot;");
  });

  it("does not honour raw HTML even when it is the whole message", () => {
    const markup = md('<a href="javascript:alert(1)">click</a>');

    expect(tagsIn(markup)).toEqual(["div", "p", "/p", "/div"]);
    expect(markup).not.toContain("<a ");
    // The javascript: URL is inert escaped text inside the paragraph, not an href.
    expect(markup).toContain("&lt;a href=&quot;javascript:alert(1)&quot;&gt;");
  });

  it("blocks javascript:, data: and vbscript: links — the text survives, the anchor does not", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html;base64,PHNjcmlwdD4=", "vbscript:msgbox"]) {
      const markup = md(`[click me](${bad})`);
      expect(markup).not.toContain("<a ");
      expect(markup).toContain("click me");
    }
  });

  it("blocks relative in-app links — LLM prose must not deep-link into app routes", () => {
    const markup = md("[open settings](/settings/danger?confirm=1)");

    expect(markup).not.toContain("<a ");
    expect(markup).not.toContain("/settings/danger");
    expect(markup).toContain("open settings");
  });

  it("blocks same-scheme-relative links — `https:/settings` is an IN-APP path, not an external URL", () => {
    // 复审 r1 P2-1:只比对冒号前的 scheme 会放行这些形式。在 HTTPS 页面上浏览器把
    // `https:/settings`、`https:settings`、`https:?confirm=1` 解析成本站路径 / 当前页,
    // 所以它们和 `/settings/danger` 属于同一类「指向本站作用路由的诱导链接」,必须同样不成锚。
    // `//evil.example` 是协议相对形式,同理:它跟着当前页的协议走。
    for (const bad of [
      "https:/settings",
      "https:settings",
      "https:?confirm=1",
      "HTTPS:/settings",
      "https:\\settings",
      "//evil.example",
    ]) {
      expect(safeHref(bad)).toBe("");

      const markup = md(`[click me](${bad})`);
      expect(markup).not.toContain("<a ");
      expect(markup).not.toContain("href=");
      expect(markup).toContain("click me");
    }
  });

  it("gives allowed external links target=_blank and the full rel guard", () => {
    const markup = md("[Meta docs](https://developers.facebook.com/docs)");

    expect(markup).toContain('href="https://developers.facebook.com/docs"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer nofollow ugc"');
  });

  it("allows mailto: (support links) and nothing else with a colon", () => {
    expect(md("[mail us](mailto:hi@fikirtive.com)")).toContain('href="mailto:hi@fikirtive.com"');
    expect(safeHref("https://a.test/x")).toBe("https://a.test/x");
    // 大写 scheme 仍然放行,但 `new URL()` 会规范化它 —— href 属性与浏览器真正会去的地址一致。
    expect(safeHref("HTTP://a.test/x")).toBe("http://a.test/x");
    expect(safeHref("mailto:a@b.test")).toBe("mailto:a@b.test");
    expect(safeHref("javascript:alert(1)")).toBe("");
    expect(safeHref("  javascript:alert(1)")).toBe("");
    expect(safeHref("/billing")).toBe("");
    expect(safeHref("evil.test/x")).toBe("");
  });

  it("never emits an <img> for a markdown image — zero-click exfiltration is closed", () => {
    const markup = md("![tracking pixel](https://evil.test/p.png?who=merchant-42)");

    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("evil.test");
    expect(markup).toContain('class="otto-prose-noimg"');
    expect(markup).toContain("tracking pixel");
  });

  it("falls back to a neutral label when a blocked image has no alt text", () => {
    expect(md("![](https://evil.test/p.png)")).toContain(">image</span>");
  });
});

describe("render exits — every surface that shows Otto prose (#586 acceptance)", () => {
  const SAMPLE = "**Credits left:** 13.2\n\n- wallet image";

  it("exit 1/4 · TextPart (OttoChatStream, streaming + reloaded history) renders markdown", () => {
    const markup = renderToStaticMarkup(
      createElement(TextPart, { role: "assistant" as const, text: SAMPLE }),
    );

    expect(markup).toContain('class="otto-prose"');
    expect(markup).toContain("<strong>Credits left:</strong>");
    expect(markup).toContain("<li>wallet image</li>");
  });

  it("exit 1/4 · TextPart leaves the USER bubble literal (merchant text is never parsed)", () => {
    const markup = renderToStaticMarkup(
      createElement(TextPart, { role: "user" as const, text: SAMPLE }),
    );

    expect(markup).not.toContain("otto-prose");
    expect(markup).not.toContain("<strong>");
    expect(markup).toContain("**Credits left:**");
    expect(markup).toContain("pre-wrap");
  });

  it("exit 2/4 · OttoConversation — wiring check on the SOURCE text, NOT a render assertion", async () => {
    // OttoConversation pulls in server actions, so assert on the source wiring rather
    // than rendering the whole tree: the assistant branch must use OttoMarkdown and must
    // no longer carry the pre-wrap class that produced the literal asterisks.
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      new URL("../../components/otto/OttoConversation.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('import { OttoMarkdown } from "./parts/OttoMarkdown"');
    expect(source).toContain("<OttoMarkdown text={m.text} />");
    // The remaining pre-wrap bubble is the USER one; there must be exactly one left.
    expect(source.match(/whitespace-pre-wrap/g)?.length).toBe(1);
  });

  it("exit 3/4 · OttoMemory — wiring check on the SOURCE text, NOT a render assertion", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      new URL("../../components/otto/OttoMemory.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('import { OttoMarkdown } from "./parts/OttoMarkdown"');
    expect(source).toContain('b.role === "you" ? b.text : <OttoMarkdown text={b.text} />');
  });

  it("exit 4/4 · ResearchReport renders the synthesis as markdown", () => {
    const markup = renderToStaticMarkup(
      createElement(ResearchReport, {
        cardId: "m1",
        payload: {
          topic: "competitor pricing",
          synthesis: "**Three findings:**\n\n1. cheaper bundles\n2. no video tier",
          sources: [{ title: "Example", url: "https://example.test/a" }],
        },
      }),
    );

    expect(markup).toContain('class="otto-prose"');
    expect(markup).toContain("<strong>Three findings:</strong>");
    expect(markup).toContain("<ol>");
    expect(markup).not.toContain("**Three findings:**");
  });
});
