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
  constructor(body?: unknown, init?: { status?: number; headers?: unknown }) {
    this.body = body;
    this.status = init?.status ?? 200;
    this.headers = init?.headers;
  }
  static json(body: unknown, init?: { status?: number }) { return new NextResponse(body, init); }
  static redirect(_url: unknown, init?: { status?: number }) { return new NextResponse(null, { status: init?.status ?? 307 }); }
}
export { NextRequest as default };
