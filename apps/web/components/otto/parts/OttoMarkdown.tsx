"use client";
import React from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

/**
 * OttoMarkdown — the ONE renderer for Otto-authored prose (#586 / #571 G1).
 *
 * Before this, every Otto reply was `white-space: pre-wrap` raw text, so merchants read
 * literal `**Credits left:** 13.2` and `- 1.0 on the wallet image`. This renders the
 * markdown Otto already emits: bold, lists, tables, code, links.
 *
 * 安全边界(三条,逐条有测试 —— apps/web/lib/__tests__/otto-markdown.test.ts):
 *
 * 1. **不开 raw HTML。** 没有 `rehype-raw`,所以 markdown 里的 `<script>` / `<img onerror>`
 *    永远不会变成 DOM。react-markdown 默认把 raw 节点降级成 **文本**(lib/index.js
 *    `transform()`:`raw` → `{type:'text'}`),React 再转义它 —— 商家看见的是字面的
 *    `<script>…`,不是执行。故意不设 `skipHtml`:静默吞掉内容会让商家以为 Otto 没说话,
 *    转义成可见文本是 fail-visible。
 *
 * 2. **URL 白名单收窄到 http / https / mailto**(`safeHref`)。比 react-markdown 自带的
 *    `defaultUrlTransform` 更窄:后者放行**相对**链接,而 Otto 的正文是 LLM 输出,可被商家
 *    自己库里的内容(产品描述、广告文案、CRM 会话)间接投毒 —— 一条 `[点这里](/settings/…)`
 *    就是一个指向本站作用路由的诱导链接。绝对外链 + mailto 之外一律不成锚,只留文字。
 *    成锚的都带 `rel="noopener noreferrer nofollow ugc"` + `target="_blank"`。
 *
 * 3. **markdown 图片不发请求。** `![x](https://外域/p.png)` 只渲染 alt 文本,不出 `<img>`。
 *    理由:图片是**零点击**的外联 —— 消息一渲染浏览器就自己去 GET 那个 URL,足够把
 *    「哪个商家、什么时候看了这条」回传给外域,不需要商家点任何东西。本仓没有可用的兜底:
 *    `apps/web/app/api/media/pub/[token]` 只代理我们自己签名的 R2 对象,给不了任意外链;
 *    `apps/web/next.config.ts` 也没有配任何 CSP,所以没有 `img-src` 兜底可依赖。
 *    Otto 真正的图走 GEN_RESULT 部件(OttoResult),不走 markdown,所以这里零损失。
 *
 * 流式:本组件是 `text` 的纯函数,useChat 每来一个 token 就整段重解析 —— 结构稳定时 React
 * 只更新文本节点,不重挂 DOM(不闪烁)。光标不作为兄弟节点追加(那会把最后一段挤成两行),
 * 而是 `.otto-prose[data-streaming="true"]` 的 `::after` 伪元素,贴在最后一个块的行尾
 * (不破段)—— 见 apps/web/app/globals.css。
 */

/** http / https / mailto only. Everything else (javascript:, data:, vbscript:, any
 *  relative in-app path, and any **same-scheme-relative** form) returns "" → the `a`
 *  component below renders plain text.
 *
 *  只比对冒号前的 scheme 不够:`https:/settings`、`https:settings`、`https:?confirm=1`
 *  的 scheme 确实是 https,但它们是**同 scheme 相对**引用 —— HTTPS 页面上浏览器把它们解析成
 *  本站路径 / 当前页,等价于边界 2 要挡的 `[点这里](/settings/…)`。所以 http/https 必须有字面的
 *  `//`,再交给 URL 解析器确认它真解析得出一个绝对 URL;解析成功返回规范化结果(浏览器实际会去的
 *  地址与 href 属性一致),解析失败一律不成锚。mailto 的既有行为不变。 */
export function safeHref(url: string): string {
  const value = url.trim();
  const colon = value.indexOf(":");
  if (colon === -1) return "";
  const scheme = value.slice(0, colon).toLowerCase();
  if (scheme === "mailto") return value;
  if (scheme !== "http" && scheme !== "https") return "";
  if (!/^https?:\/\//i.test(value)) return "";
  try {
    return new URL(value).href;
  } catch {
    return "";
  }
}

/** `remark-breaks` 不是装饰,是防回归:markdown 默认把单个换行折成空格,
 *  `**Credits left:** 13.2\nHere's what I can tell you:` 会并成一行 —— 比现在的 pre-wrap 还差。
 *  聊天产品一律把单换行当断行;加上它,「渲染 markdown」才不会顺手弄坏分行。 */
const REMARK_PLUGINS = [remarkGfm, remarkBreaks];

const COMPONENTS: Components = {
  // Boundary 2 — a blocked URL never becomes an anchor; the link text survives as text.
  a({ href, children }) {
    if (!href) return <>{children}</>;
    return (
      <a href={href} target="_blank" rel="noopener noreferrer nofollow ugc">
        {children}
      </a>
    );
  },
  // Boundary 3 — markdown images are never fetched; alt text stands in for them.
  img({ alt }) {
    return <span className="otto-prose-noimg">{alt || "image"}</span>;
  },
  // Wide tables scroll inside their own box instead of widening the chat bubble.
  table({ children }) {
    return (
      <div className="otto-prose-scroll">
        <table>{children}</table>
      </div>
    );
  },
};

export interface OttoMarkdownProps {
  /** The (possibly mid-stream) Otto-authored markdown. */
  text: string;
  /** True while this text is actively streaming → show the trailing caret. */
  streaming?: boolean;
}

function OttoMarkdownImpl({ text, streaming }: OttoMarkdownProps) {
  return (
    <div className="otto-prose" data-streaming={streaming ? "true" : undefined}>
      <Markdown remarkPlugins={REMARK_PLUGINS} urlTransform={safeHref} components={COMPONENTS}>
        {text}
      </Markdown>
    </div>
  );
}

/** Memoised so a parent re-render (new token on a SIBLING message, poll tick, balance
 *  refresh) does not re-parse every settled message in the thread. */
export const OttoMarkdown = React.memo(OttoMarkdownImpl);

export default OttoMarkdown;
