# Staging 匿名 HTTP 边界检查

执行时间：2026-09-14T04:08:12.451696+00:00。目标仅 https://web-staging-7901.up.railway.app。本地源码 HEAD：14bcd038b386d6e7d6ad98bbc716aaf018a23314。

范围：20个 GET 检查；未跟随重定向，未保存 cookie、个人信息或完整 HTML。唯一显式 Cookie 是人工伪造的分享 token。未触发认证邮件、OAuth、provider、POST 或付费业务。此报告是 HTTP 协议证据，不是浏览器 UI 验收。

执行说明：首次 Python urllib 20次均在 HTTP 状态前失败（URLError，未获状态，不能计为业务失败）；改用系统 curl 保持证书验证后完成以下检查。另用 /api/ready 做过一次 curl 连通性诊断（200）。共20个不同检查、21个已取得 HTTP 响应的 GET。

| GET 路径／条件 | 状态 | Location（仅路径） | 响应形状 | 预期依据 |
|---|---:|---|---|---|
| `/api/health` | 200 | `—` | `{"ok": true, "db": "up", "worker": "up", "workers": {"worker": "stale", "worker-compute": "up", "worker-wait": "up"}, "backup": "missing", "migrations": "applied", "build": {"sha": "14bcd038", "ref": "main"}}` | `app/api/health/route.ts`：存活恒200，公开状态字段 |
| `/api/ready` | 200 | `—` | `{"ready": true, "db": "up", "migrations": "applied"}` | `app/api/ready/route.ts`：DB可达且迁移成功200 |
| `/api/ops/dlq` | 503 | `—` | `{"ok": false, "deadLetters": "backed-up"}` | `app/api/ops/dlq/route.ts`：clear=200，其余503 |
| `/` | 307 | `/login?from=%2F` | `{"redirect_body_only": true}` | `apps/web/proxy.ts`：未认证 307→login，from 保留路径和参数 |
| `/library` | 307 | `/login?from=%2Flibrary` | `{"redirect_body_only": true}` | `apps/web/proxy.ts`：未认证 307→login，from 保留路径和参数 |
| `/create` | 307 | `/login?from=%2Fcreate` | `{"redirect_body_only": true}` | `apps/web/proxy.ts`：未认证 307→login，from 保留路径和参数 |
| `/schedule` | 307 | `/login?from=%2Fschedule` | `{"redirect_body_only": true}` | `apps/web/proxy.ts`：未认证 307→login，from 保留路径和参数 |
| `/billing` | 307 | `/login?from=%2Fbilling` | `{"redirect_body_only": true}` | `apps/web/proxy.ts`：未认证 307→login，from 保留路径和参数 |
| `/admin/money` | 307 | `/login?from=%2Fadmin%2Fmoney` | `{"redirect_body_only": true}` | `apps/web/proxy.ts`：未认证 307→login，from 保留路径和参数 |
| `/api/otto/thread-activity` | 307 | `/login?from=%2Fapi%2Fotto%2Fthread-activity` | `{"redirect_body_only": true}` | `apps/web/proxy.ts`：未认证 307→login，from 保留路径和参数 |
| `/settings/connections` | 307 | `/login?from=%2Fsettings%2Fconnections` | `{"redirect_body_only": true}` | `apps/web/proxy.ts`：未认证 307→login，from 保留路径和参数 |
| `/files/u/e2e-nonexistent-20260914/0000000000000000000000000000000000000000000000000000000000000000.png` | 307 | `/login?from=%2Ffiles%2Fu%2Fe2e-nonexistent-20260914%2F0000000000000000000000000000000000000000000000000000000000000000.png` | `{"redirect_body_only": true}` | `apps/web/proxy.ts`：未认证 307→login，from 保留路径和参数 |
| `/files/u/e2e-nonexistent-20260914/0000000000000000000000000000000000000000000000000000000000000000.png?download=1` | 307 | `/login?from=%2Ffiles%2Fu%2Fe2e-nonexistent-20260914%2F0000000000000000000000000000000000000000000000000000000000000000.png%3Fdownload%3D1` | `{"redirect_body_only": true}` | `apps/web/proxy.ts`：未认证 307→login，from 保留路径和参数 |
| `/schedule/share-preview` | 200 | `—` | `{"unavailable_notice": true, "media_url": false}` | `app/schedule/share-preview/page.tsx`：无token／重复t→unavailable |
| `/schedule/share-preview?t=e2e-invalid-a&t=e2e-invalid-b` | 200 | `—` | `{"unavailable_notice": true, "media_url": false}` | `app/schedule/share-preview/page.tsx`：无token／重复t→unavailable |
| `/schedule/share-preview（人工伪造分享cookie）` | 200 | `—` | `{"unavailable_notice": true, "media_url": false}` | `lib/share-preview-view.ts`：坏签名在计数／DB前拒绝 |
| `/api/media/pub/e2e-invalid-token-20260914` | 404 | `—` | `{"exact_not_found": true}` | `app/api/media/pub/[token]/route.ts`：坏签名先404，不采信ownerId参数 |
| `/api/media/pub/e2e-invalid-token-20260914?ownerId=e2e-nonexistent` | 404 | `—` | `{"exact_not_found": true}` | `app/api/media/pub/[token]/route.ts`：坏签名先404，不采信ownerId参数 |
| `/api/better-auth/reset-password/e2e-nonexistent-20260914` | 404 | `—` | `{"exact_not_found": true}` | `app/api/better-auth/[...all]/route.ts`＋`lib/better-auth/server.ts:84`：退役reset-password/前缀404；SIGNIN-A4 |
| `/signup` | 308 | `/login` | `{"redirect_body_only": false}` | `app/signup/page.tsx`；SIGNIN-A4：回login |

## 结论和限制

受保护页面／API／人工不存在文件请求均307回登录，仅重定向正文；非法媒体 token 与退役密码 GET 均404。分享拒绝页按现行实现返回200并显示 unavailable，没有公开媒体 URL；这不是成功读取分享内容。健康与就绪同时为200，但含义不同。未制造DB故障，因此未实测ready的503分支。

实测异常：死信探针503且 `deadLetters=backed-up`。源码 `apps/web/lib/dlq-watch.ts` 读取真实队列job计数并最多缓存30秒；这证明探针当时观察到待处理死信，未调查归属／原因，不能宣称全系统健康。

健康字段补充：`backup=missing` 表示探针没有读到一次成功备份的完成时间（`apps/web/lib/health.ts:46`）；不等于已检查所有外部备份。`workers.worker=stale` 而compute/wait均up：同文件 `workersHealth` 明确记录拆分后旧worker行可能不再更新，不能仅据此断言当前worker宕机。

`/signup` 的308正文包含框架HTML，故 `redirect_body_only=false`；源码为 `permanentRedirect("/login")`，不是鉴权墙裸重定向。状态和Location符合退役页面契约。

副作用边界：没有业务写入或专用遥测请求；事后深入核查发现死信探针在非clear时可能调用 `Sentry.captureMessage`（`apps/web/lib/dlq-watch.ts:96-135`，取决于服务器配置与30秒缓存）。是否实际发出不可从本次HTTP证明，不能宣称完全零遥测。未追加该探针请求。

规范证据：`docs/specs/sign-in.md`（2026-09-08批准，SIGNIN-A4）；`docs/specs/share-preview.md`（2026-09-12批准，SHARE-A8与公开授权边界）。此次仅覆盖坏／缺token，不覆盖真实撤销、过期、双租户或合法大文件Range。

CodeGraph: not used — worker 位于独立worktree，依项目规矩用rg与当前文件。无产品代码修改。
