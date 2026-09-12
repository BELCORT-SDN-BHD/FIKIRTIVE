import "server-only";
import { prisma } from "@fikirtive/db";
import { runAsSystem } from "@fikirtive/db/principal";
import { newId, FOUNDER_OWNER_ID } from "@fikirtive/core";
import { isFounderAdmin } from "@/lib/allowlist";
import { admitSelfSignup } from "@/lib/signup-gate";
import { SIGN_IN_DOOR_UNKNOWN } from "./signin-door-source";

/** #538 — is this the deliberate "revoked mid-provisioning" refusal thrown by
 *  bootstrapPersonalOrg? Matched by NAME, not `instanceof`: auth-guard is loaded through a
 *  dynamic import below (it imports better-auth/compat, which reaches back here — a static
 *  import would close that cycle), so the constructor identity is not reliably in scope. */
function isProvisioningRefusal(e: unknown): boolean {
  return e instanceof Error && e.name === "RevokedDuringProvisioning";
}

/** Convergence on BA sign-in. Mirrors auth.ts events.signIn but keyed off email
 *  (the canonical join key). Idempotent, best-effort, and throws for exactly ONE reason —
 *  requireOwner() remains the authoritative fail-closed resolver.
 *
 *  #538 CARVE-OUT to "never throws": if provisioning was deliberately rolled back because the
 *  operator revoked this address mid-signup, that refusal propagates instead of being logged
 *  as a non-fatal hiccup. Reporting success there degraded a security decision into a generic
 *  allowlist denial with no server-side trace. Every OTHER failure stays non-fatal exactly as
 *  before. Security did not depend on this — the session gate already refuses a revoked
 *  address — but the error semantics did.
 *
 *  #463 — the canonical system context. Better Auth runs this from its user/session create
 *  hooks, which fire BEFORE setSessionCookie: there is no cookie, so getSession() returns
 *  null and no user principal can exist here by construction. Rather than re-order writes
 *  that cannot be re-ordered, the whole body runs under the named identity
 *  "auth:converge-identity". The emailVerified gate stays FIRST (outside the wrapper, so an
 *  unverified identity still performs zero work), and the idempotency / founder-atomicity /
 *  allowlist-ordering constraints are all unchanged. (#538 narrowed never-throw to the single
 *  carve-out documented above; every other failure is still swallowed as non-fatal.) */
export async function convergeIdentity(input: { email: string; name?: string | null; image?: string | null; emailVerified?: boolean; sessionId?: string | null; door?: string }): Promise<void> {
  if (!input.emailVerified) return; // never converge (esp. founder super-admin promote) on an unverified identity
  // SIGNIN-A16 —— 一处归一化，全程用它。`AllowedEmail.email` 没有大小写不敏感的唯一约束
  // （#578），所以 `Aisha@Example.com` 与 `aisha@example.com` 只有在每个写侧都先小写时才会落到
  // 同一行、同一个账号上。
  const email = input.email.trim().toLowerCase();
  await runAsSystem("auth:converge-identity", async () => {
    // FSE-209 —— 这一次登录发生在哪个租户名下。第 4 步的审计行挂在它上面，所以它在这里
    // 被记下来，而不是在那一步另外查一次：founder 那一支与商家那一支各自已经知道答案了。
    let tenantOrgId: string | null = null;
    try {
      // 0. SIGNIN-A1/A10 —— 「注册即邀请」（#543）。第一次成功登录（两扇门都算）把邮箱写进
      //    `AllowedEmail`：status active，`invitedBy` 记来源门。它必须发生在下面的
      //    `bootstrapPersonalOrg` **之前** —— 那笔事务会读这一行来决定「操作员是不是在开户
      //    中途撤销了这个地址」（#538 的两阶段协议）。
      //
      //    这一行是码门对陌生人打开之后，**唯一**把「他证明了自己拥有这个邮箱」写下来的地方：
      //    从此每一个已有的 deny-by-default 再断言（`isAllowedEmail`、`requireSession`、
      //    `requireOwner`、后台的那几处）继续照旧工作 —— 门开了，墙没有动。
      //
      //    `skipDuplicates` 让它永不复活一行 `revoked`（那正是撤销要绝对的原因）。
      await admitSelfSignup(email, input.door ?? SIGN_IN_DOOR_UNKNOWN);
      // 1. Ensure the canonical User row exists (BA identities reconnect to the tenant graph by email).
      //    #544 — mirror emailVerified onto the canonical row. We only reach here when
      //    input.emailVerified is true (the early return above), so a create stamps the
      //    verification and an existing row is stamped ONCE if it is still null. The canonical
      //    column is a DateTime? (next-auth convention): a timestamp means verified. Set-once —
      //    a later convergence never overwrites an earlier stamp (the `emailVerified: null`
      //    filter no-ops once set), so the moment-of-verification is preserved.
      let user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, emailVerified: true },
      });
      if (!user) {
        user = await prisma.user.create({
          data: { email, name: input.name ?? null, image: input.image ?? null, emailVerified: new Date() },
          select: { id: true, emailVerified: true },
        });
      } else if (!user.emailVerified) {
        await prisma.user.updateMany({ where: { email, emailVerified: null }, data: { emailVerified: new Date() } });
      }
      // 2. Founder super-admin self-heal (promote-only, idempotent).
      if (isFounderAdmin(email)) {
        // FSE-209 —— founder 的租户**就是** founder org（迁移里种好的那一行，他从不走
        // `bootstrapPersonalOrg`）。所以他的登录行仍然落在这里，而且现在是因为它是他的
        // 租户，不是因为那是个写死的常量。
        tenantOrgId = FOUNDER_OWNER_ID;
        await prisma.$transaction(async (tx) => {
          await tx.user.updateMany({ where: { email, role: { not: "super-admin" } }, data: { role: "super-admin" } });
          await tx.userRole.upsert({
            where: { userId_role: { userId: user.id, role: "super-admin" } },
            create: { userId: user.id, role: "super-admin" },
            update: {},
          });
          // Mirror the canonical role onto ba_user.role in the same tx so the admin plugin's
          // HTTP gate cannot drift from requireRole's canonical User.role view.
          await tx.betterAuthUser.updateMany({ where: { email }, data: { role: "super-admin" } });
          const membership = await tx.membership.upsert({
            where: { userId_orgId: { userId: user.id, orgId: FOUNDER_OWNER_ID } },
            create: { id: newId(), userId: user.id, orgId: FOUNDER_OWNER_ID, role: "owner" },
            update: {},
            select: { id: true },
          });
          await tx.membershipRole.upsert({
            where: { membershipId_role: { membershipId: membership.id, role: "owner" } },
            create: { membershipId: membership.id, role: "owner" },
            update: {},
          });
        });
        // 2b. FSE-008 —— 演员库五人也要站在 founder 自己的 Library 里(CREATE-A10;
        //     规格 docs/specs/creation-engine.md §5 2026-09-02「每租户播种」)。
        //
        //     播种唯一的自动挂点是 `bootstrapPersonalOrg`(auth-guard.ts),而 founder
        //     **从不**走那条路:他的 org 是迁移里就种好的那一行 `FOUNDER_OWNER_ID`,不需要
        //     再开一个个人 org。于是那句 `seedActorLibrary(orgId)` 对 founder 永远到不了,
        //     他登录进去看到的是一个空的 Official avatars(2026-09-08 staging E2E:
        //     founder Entity 总数 = 0,同一时刻普通新用户是 5 位)。补的就是这一句。
        //
        //     范围刻意窄:落点是 founder 自己的 org,不新建 org、不碰租户边界,更不走
        //     `bootstrapPersonalOrg` 的开户赠额那条路 —— founder 分支一行钱都不写。
        //     `seedActorLibrary` 幂等且永不抛(见该模块头「幂等」「绝不抛」),所以每次
        //     登录重跑既不会把库播成十个人,也不会把一次登录变成失败;上次没播成的那几位
        //     下次登录补齐。**在事务之外**、提交之后 —— 与非 founder 那条路同一个理由:
        //     它要读磁盘上的定妆原件,不该把文件 IO 塞进一笔身份事务里。
        //     动态 import 与下面 auth-guard 那处同理,避免把 storage/文件系统这一段拖进
        //     better-auth 的静态模块图。
        //
        //     判官 P2(2026-09-08)—— best-effort 要自己兜住:`seedActorLibrary` 承诺永不抛,
        //     但那是它的承诺,不是这里的保证(动态 import 本身也会 reject:文件被删、构建产物
        //     缺失)。没有这层 try/catch,任何一次 reject 都直穿到下面 172 行的外层 catch,
        //     把第 4 步的 auth.signin 审计写整个跳过 —— 一次真实登录从审计流里消失。演员库
        //     少五张脸不该有这种代价,所以照非 founder 那条路(:103)的写法就地降级成 warn。
        //     #575 日志纪律:固定分类 + 常量,邮箱这类用户内容不进日志行。
        try {
          const { seedActorLibrary } = await import("@/lib/actor-library-seed");
          await seedActorLibrary(FOUNDER_OWNER_ID);
        } catch (e) {
          console.warn("[better-auth] converge founder actor-library seed failed (non-fatal):", e instanceof Error ? e.message : e);
        }
      } else {
        // 3. Non-founder personal-org convergence (best-effort; requireOwner re-bootstraps on demand).
        try {
          const { bootstrapPersonalOrg } = await import("@/lib/auth-guard");
          // FSE-209 —— 它回的就是这次登录的租户（`org_<userId>`，确定性的那一个）。
          tenantOrgId = await bootstrapPersonalOrg(user.id, email);
        } catch (e) {
          // #538 — every bootstrap failure is a retryable hiccup EXCEPT one: the operator's
          // revoke won the AllowedEmail row mid-provisioning and the tx was rolled back on
          // purpose. Swallowing that left the refusal traceless in the logs and let
          // convergence report success, degrading a security decision into a generic denial.
          // #575 log discipline: fixed category and constants only — an email address is user
          // content and never reaches a log line here.
          if (isProvisioningRefusal(e)) {
            console.error("[better-auth] converge: provisioning refused — address revoked during signup");
            throw e; // deliberate: see the never-throws carve-out above
          }
          console.warn("[better-auth] converge bootstrap failed (non-fatal):", e instanceof Error ? e.message : e);
        }
      }
      // 4. Audit.
      //
      // #735 — `ownerId` is the event's DATA SCOPE (a foreign key to Organization), not the
      // person. WHO signed in is `payload.email`, and it comes from the Better Auth identity
      // this function was handed after the `emailVerified` gate above — never from anything a
      // client supplied.
      //
      // FSE-209 —— THE SCOPE IS THE TENANT THIS LOGIN HAPPENED IN, not a constant. It used to be
      // `FOUNDER_OWNER_ID` for everyone, on the argument that a sign-in belongs to a
      // platform-wide stream; staging measured what that costs (走查 2026-09-11,
      // `docs/audits/fullstack-staging-2026-09-11/backend-evidence.md` §2.8): every `auth.signin`
      // row in the database, 26 of 26, sat under the founder org, so no merchant could find their
      // own sign-in by asking for their own data. The row count was right, the ownership was not.
      // S5 批量裁决 2026-09-12 (`docs/specs/sign-in.md` §5): hang it on the tenant.
      //
      // The founder console did not lose anything: its audit read is the whole table
      // (`lib/admin-v2.ts`, `where: { ownerId: { not: "" } }`), never a founder-org filter — and
      // the founder's own sign-ins still land on the founder org, because that IS his tenant.
      //
      // NO TENANT, NO ROW. `ownerId` is a foreign key to Organization, so a row invented under a
      // guessed id would simply be rejected by the database and swallowed by the `.catch` below.
      // The only way to get here without a tenant is a bootstrap that failed (best-effort, step 3
      // above; `requireOwner` re-bootstraps on the merchant's next request) — and in that state
      // there is no org to own the row yet. Falling back to the founder org would put the lie
      // FSE-209 just removed back in the table for exactly the cases nobody is watching.
      //
      // #737 — IDEMPOTENT, like every other step above it. One login calls this function more
      // than once by construction (Better Auth fires it from the user-create hook AND the
      // session-create hook, tens of milliseconds apart), and a second verification click or a
      // racing tab fires it again. The account, the personal org and the welcome grant all
      // already survived that; only the audit write did not, so one login was recorded twice —
      // and anything later counted off this table (sign-in frequency, a lockout threshold)
      // doubled with it.
      //
      // THE KEY IS THE SESSION, because the session IS the sign-in. Better Auth mints exactly
      // one session row per successful sign-in and hands its id to the session-create hook, so
      // `signin:<sessionId>` identifies the EVENT: every convergence belonging to that one login
      // computes the same key, and two genuinely separate logins can never collide however close
      // together they happen. (A wall-clock window would have keyed a USER rather than an event:
      // two real logins a few seconds apart would fold into one row, and the DB-level dedupe
      // below — correct in itself — would make the swallowed one unrecoverable.)
      //
      // The key is the row's own primary key, so the DEDUPE IS THE DATABASE: `skipDuplicates`
      // becomes ON CONFLICT DO NOTHING, which two racing requests cannot both win and which
      // NEVER rewrites the row already there (the first moment stands as recorded). Same shape
      // as the welcome grant's `signup:<orgId>` key one step above.
      //
      // NO SESSION, NO SIGN-IN ROW — and `sessionId` is only ever passed when the session that
      // was just created IS a sign-in (see signin-session.ts; impersonation and the
      // password-change rotation deliberately pass null).
      //
      // The other two callers converge without a session at all: the user-create hook and
      // afterEmailVerification. Neither is a login of its own — each is the FIRST HALF of one
      // login whose session-create convergence writes that login's single row. Concretely, a
      // first-time sign-in-code login creates the user (verified) and then the session, so this
      // function ran twice tens of milliseconds apart and, before this fix, appended twice.
      //
      // Self-service registration never reached this line even before: it is held at
      // `requireEmailVerification`, so the account exists with emailVerified false and the gate
      // on the FIRST line of this function returns before any of the above runs.
      if (input.sessionId && tenantOrgId) {
        await Promise.resolve(
          prisma.actionEvent.createMany({
            data: [{ id: `signin:${input.sessionId}`, ownerId: tenantOrgId, type: "auth.signin", payload: { email } }],
            skipDuplicates: true,
          }),
        ).catch(() => {});
      }
    } catch (e) {
      // The one deliberate exception to never-throws (#538): a provisioning refusal is a
      // security decision, not a convergence hiccup, and must not be downgraded here either.
      if (isProvisioningRefusal(e)) throw e;
      console.warn("[better-auth] convergeIdentity failed (non-fatal):", e instanceof Error ? e.message : e);
    }
  });
}
