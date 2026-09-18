/**
 * R3-F32（第三轮 staging 只读核证，2026-09-17）—— 旧式分享链接
 * `/schedule/share-preview?t=<token>` 必须在**任何外壳冲出去之前**就被一条真的 HTTP 重定向答掉。
 *
 * 修前 staging 上它答的是 HTTP 200（约 25 KB）：一段
 * `<meta id="__next-page-redirect" http-equiv="refresh" content="1;url=/s/<token>">`，外加一屏
 * 已经冲出去的外壳（里面带着 `href="/login"` 的「Go to sign in」）。于是顾客的地址栏上停着那个
 * token 约一秒，并且在一张「无登录、无回工作区的路」的页面上（`app/schedule/share-preview/
 * page.tsx:33` 的自述、规格 SHARE-A6）先闪一下登录面的东西。
 *
 * 机制不是猜的，仓内已经实测并写在 `lib/parked-route-redirect.ts`（2026-09-15，`next build` +
 * `next start` + `curl --max-redirs 0`）：这一段头上压着 `app/schedule/loading.tsx` —— 一个
 * Suspense 边界 —— Next 会先把外壳当 200 冲出去，`page.tsx` 里的 `redirect()` 就只能降级成一次
 * 客户端跳转（meta refresh）。同一份实测也写明了答法：**根本不要进渲染**。停放旧地址走的是
 * Route Handler；这一条不行（`/schedule/share-preview` 本身必须还是那张页面），所以它退到更外
 * 面一层 —— Next 的路由层重定向表（`next.config.ts` 的 `redirects()`），它在渲染开始之前就答完。
 *
 * 规则搬出 `next.config.ts` 成一个普通值，是 `lib/security-headers.ts` 已经立过的形状：写在配置
 * 文件里的就是一个没人能核的承诺。下面第二族真的把 `next.config.ts` 载进来对账，所以「值对」与
 * 「配置真的用了这个值」是分开证的两件事。
 *
 * 这里证的是**规则这个值**与**接线**。真正的 HTTP 状态码、空正文、没有 `__next-page-redirect`，
 * 只有一台真服务器答得了：e2e journey 30（`e2e/journeys/30-share-link-entry.spec.ts`）。
 */
import { describe, it, expect } from "vitest";
import {
  legacyShareLinkRedirects,
  LEGACY_SHARE_LINK_QUERY,
  LEGACY_SHARE_LINK_VALUE,
} from "@/lib/legacy-share-link-redirect";
import { signSharePreviewToken } from "@fikirtive/token-crypto";
import { SHARE_PREVIEW_COOKIE_PATH } from "@/lib/share-preview-cookie";

const rules = () => legacyShareLinkRedirects();
const legacy = () => rules().find((rule) => rule.source === SHARE_PREVIEW_COOKIE_PATH);

describe("R3-F32 —— 旧式 `?t=` 链接的路由层重定向规则", () => {
  it("有这么一条规则，且它守的正是那张公开预览页自己的地址", () => {
    expect(legacy(), "旧式 `?t=` 链接没有任何路由层规则 —— 它会一路走到渲染，再降级成 meta refresh").toBeDefined();
    // 地址只有一份（`lib/share-preview-cookie.ts`），这里不许手打第二遍。
    expect(legacy()?.source).toBe(SHARE_PREVIEW_COOKIE_PATH);
  });

  it("只在带 `?t=` 时才拦 —— 干净地址（cookie 那条路）一个字都不碰", () => {
    const has = legacy()?.has ?? [];
    expect(has).toHaveLength(1);
    expect(has[0]?.type).toBe("query");
    expect(has[0]?.key).toBe(LEGACY_SHARE_LINK_QUERY);
  });

  /**
   * 这一条钉的是本机实测出来的那个 500（模块头 ①）：不带 `value` 的 `has` 会把重复的
   * `?t=a&t=b` 原样当成数组塞进 `/s/:t`，编译当场抛。`value` 在这里不是装饰。
   */
  it("`?t=` 带值匹配，且捕获组的名字与去处里那个占位符是同一个", () => {
    const value = legacy()?.has?.[0]?.value;
    expect(value, "没有 value：重复的 `?t=a&t=b` 会被当成数组，Next 编译去处时当场 500").toBe(
      LEGACY_SHARE_LINK_VALUE,
    );
    expect(value).toContain(`(?<${LEGACY_SHARE_LINK_QUERY}>`);
  });

  it("真 token 的形状全中 —— 不然这条规则等于没拦", () => {
    const matcher = new RegExp(`^${LEGACY_SHARE_LINK_VALUE}$`);
    // `<base64url>.<base64url>`(packages/token-crypto)。取几个真的签出来核，不手抄字符集。
    for (const token of [
      signSharePreviewToken("org_a", "post_1", 1_800_000_000_000, "secret-one"),
      signSharePreviewToken("org_b", "post_2", 1_900_000_000_000, "secret-two"),
      signSharePreviewToken("org_c-with-dash_and_underscore", "post_3", 2_000_000_000_000, "s3"),
    ]) {
      expect(matcher.test(token), `真 token 不匹配：${token}`).toBe(true);
    }
  });

  it("拼得出畸形 `Location` 的值一概不收（落回页面里那句后备转发，也就是修前的行为）", () => {
    const matcher = new RegExp(`^${LEGACY_SHARE_LINK_VALUE}$`);
    // `..` / `.`（以及解码后同样是它们的 `%2e%2e`）：跨厂复审 P3。旧字符集收它们，去处会编译成
    // `/s/..`——不是开放重定向（无主机名、无协议，浏览器同源解析），但一条相对上跳没理由从这条
    // 规则里出去。收紧成「首字符不许是点」之后，它们落回页面那句后备转发，也就是修前的行为。
    for (const bad of ["a/b", "a b", "a?b", "a#b", "a%2Fb", "", "http://evil.test", "..", ".", "...."]) {
      expect(matcher.test(bad), `不该收：${bad}`).toBe(false);
    }
  });

  it("去处是 `/s/<token>` —— 与页面里那条后备转发同一个门", () => {
    expect(legacy()?.destination).toBe(`/s/:${LEGACY_SHARE_LINK_QUERY}`);
  });

  it("不是永久重定向 —— 旧链接的形状不该被浏览器永久缓存住", () => {
    expect(legacy()?.permanent).toBe(false);
  });

  it("重定向表里没有第二条 —— 这一版只收旧式分享链接这一件事", () => {
    expect(rules()).toHaveLength(1);
  });
});

describe("R3-F32 —— next.config.ts 真的接上了这张表", () => {
  it("redirects() 就是 legacyShareLinkRedirects 的结果，一条不多一条不少", async () => {
    const config = (await import("@/next.config")).default;
    expect(
      typeof config.redirects,
      "next.config.ts 没有 redirects() —— 旧链接又回到 200 + meta refresh 那条路上",
    ).toBe("function");
    expect(await config.redirects!()).toEqual(legacyShareLinkRedirects());
  });
});
