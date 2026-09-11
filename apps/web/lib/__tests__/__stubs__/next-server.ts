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
export class NextResponse {
  status: number;
  body: unknown;
  headers: unknown;
  /** Where a redirect points. 只有 `redirect()` 会填它 —— 墙把人送去哪里是可断言的事实
   *  （`lib/__tests__/proxy.test.ts` 的 SIGNIN-A7 用例），不该只能看到一个 307。 */
  url?: string;
  constructor(body?: unknown, init?: { status?: number; headers?: unknown }) {
    this.body = body;
    this.status = init?.status ?? 200;
    this.headers = init?.headers;
  }
  static json(body: unknown, init?: { status?: number }) { return new NextResponse(body, init); }
  static redirect(url: unknown, init?: { status?: number }) {
    const res = new NextResponse(null, { status: init?.status ?? 307 });
    res.url = String(url);
    return res;
  }
}
export { NextRequest as default };
