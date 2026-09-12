// Stub for `next/server` in vitest/node integration tests.
// next-auth imports NextRequest from next/server; we don't need it in tests
// (auth() itself is mocked). Stub the exports it needs.
export class NextRequest {
  nextUrl: URL;
  constructor(url: string, init?: RequestInit) {
    void init;
    this.nextUrl = new URL(url);
  }
}
/**
 * SHARE-A6 —— 极简版 `ResponseCookies`。只覆盖 `app/s/[token]/route.ts` 需要的那一件事
 * （写一个带属性的 cookie,再读回来断言),不是真 Next 的完整实现（domain、多值等一概没有）。
 */
class StubResponseCookies {
  private readonly store = new Map<string, { value: string } & Record<string, unknown>>();
  set(name: string, value: string, options?: Record<string, unknown>) {
    this.store.set(name, { value, ...options });
    return this;
  }
  get(name: string) {
    return this.store.get(name);
  }
}

export class NextResponse {
  status: number;
  body: unknown;
  headers: unknown;
  /** Where a redirect points. 只有 `redirect()` 会填它 —— 墙把人送去哪里是可断言的事实
   *  （`lib/__tests__/proxy.test.ts` 的 SIGNIN-A7 用例），不该只能看到一个 307。 */
  url?: string;
  readonly cookies = new StubResponseCookies();
  constructor(body?: unknown, init?: { status?: number; headers?: unknown }) {
    this.body = body;
    this.status = init?.status ?? 200;
    this.headers = init?.headers;
  }
  static json(body: unknown, init?: { status?: number }) { return new NextResponse(body, init); }
  static redirect(url: unknown, init?: { status?: number } | number) {
    const status = typeof init === "number" ? init : (init?.status ?? 307);
    const res = new NextResponse(null, { status });
    res.url = String(url);
    return res;
  }
}
export { NextRequest as default };
