/**
 * 商家的时刻不随「数据库服务端装在哪个时区」漂移。
 *
 * 这条测试钉的是一个**写入正确性**缺陷,不是测试环境的便利。
 *
 * `@prisma/adapter-pg@7.8.0` 的 `formatDateTime`(`dist/index.mjs:353`)把 JS `Date`
 * 序列化成「UTC 墙钟、但不带任何偏移」的裸字符串,例如 `2099-01-01 00:00:00`。
 * Postgres 收到裸字符串写进 `timestamptz` 列时,按**会话时区**解释它。于是:
 *
 *   服务端默认时区 = UTC              → 落库时刻正确(CI 的 postgres:16 就是这一档)
 *   服务端默认时区 = Asia/Kuala_Lumpur → 每个 Date 参数整体早 8 小时
 *
 * 实测证据(本机 Postgres 16.14,服务端默认 Asia/Kuala_Lumpur):
 *   `new Date("2099-01-01T00:00:00Z")` 经 adapter 落库成 epoch 4070880000,
 *   正确值是 4070908800 —— 差 28800 秒;同一个 Date 直接走裸 `pg` 驱动落库正确。
 *
 * 这条路同时是 ORM 写入与 `$queryRaw` 绑定的必经之地(共用 adapter 的 `mapArg`),
 * 所以受影响的不止一处测试:商家的 consent 发生时间、供应商拒收的过期时间,
 * 都会随部署机器的时区设置整体漂移 —— 库里存的是错的时刻,读出来也一直是错的。
 *
 * 修法在单一源头 `packages/db/src/client.ts`:应用自己的连接把会话时区钉死 UTC
 * (启动包参数 `-c timezone=UTC`)。裸字符串于是总被按 UTC 解释,落库时刻恒等于
 * JS `Date` 的时刻,与服务端默认时区无关。
 *
 * 两条断言:
 *   ① 应用自己的连接会话就是 UTC —— 不继承服务端默认时区;
 *   ② 一个已知 `Date` 写进真表的 `timestamptz` 列后,读回是同一个时刻。
 *      ② 在修复前于非 UTC 服务端上必红,在 UTC 服务端上必绿;① 在两种服务端上
 *      都必须绿,所以它才是那条到处都成立的守门断言。
 *
 * 零花钱:只碰 Organization / Contact / ConsentEvent,不 reserve、不 settle、不入账。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../index.js";

const ORG = "tz-org";
const CONTACT = "tz-contact";

// 挑一个夏令时与闰秒都碰不到、且远离 now() 的时刻,免得断言被「刚好相等」蒙混过去。
const INSTANT = new Date("2099-01-01T00:00:00.000Z");

beforeEach(async () => {
  await prisma.organization.create({ data: { id: ORG } });
  await prisma.contact.create({
    data: {
      id: CONTACT,
      ownerId: ORG,
      name: "TZ probe",
      source: "seed",
      firstTouchAt: new Date("2026-01-01T00:00:00.000Z"),
      lastSeenAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  });
});

describe("商家时刻不随数据库服务端时区漂移", () => {
  it("应用自己的连接把会话时区钉在 UTC,不继承服务端默认时区", async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ TimeZone: string }>>(`SHOW timezone`);
    expect(rows[0]?.TimeZone).toBe("UTC");
  });

  it("一个 Date 写进 timestamptz 列再读回,是同一个时刻(服务端默认时区无关)", async () => {
    await prisma.consentEvent.create({
      data: {
        id: "tz-event",
        ownerId: ORG,
        contactId: CONTACT,
        channel: "whatsapp",
        purpose: "marketing",
        action: "grant",
        actorKind: "customer",
        entryMode: "interactive",
        sourceKind: "double_optin",
        evidenceStatus: "verified",
        evidenceRef: "evidence:tz",
        operationId: "operation:tz",
        idempotencyKey: "tz:probe",
        occurredAt: INSTANT,
        receivedAt: INSTANT,
      },
    });

    const rows = await prisma.$queryRawUnsafe<Array<{ occurred: string; received: string }>>(
      `SELECT extract(epoch from "occurredAt")::text AS occurred,
              extract(epoch from "receivedAt")::text AS received
         FROM "ConsentEvent" WHERE "id" = 'tz-event'`,
    );
    const expected = String(INSTANT.getTime() / 1000);
    expect(Number(rows[0]?.occurred)).toBe(Number(expected));
    expect(Number(rows[0]?.received)).toBe(Number(expected));
  });
});
