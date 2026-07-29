/**
 * /api/meta/data-deletion 集成测试(真库)——Meta App Review 的合规前置。
 * Meta POST form-encoded signed_request;有效 → 删除匹配的 MetaConnection(加密
 * token 一并消失)+ 记 ActionEvent + 返回 {url, confirmation_code};无效 → 400。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { prisma } from "@fikirtive/db";
import { POST } from "../route";

const SECRET = "test-app-secret";
process.env.META_APP_SECRET = SECRET;

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function signedRequest(userId: string): string {
  const encoded = b64url(Buffer.from(JSON.stringify({ user_id: userId, algorithm: "HMAC-SHA256" })));
  return `${b64url(createHmac("sha256", SECRET).update(encoded).digest())}.${encoded}`;
}
function post(body: string): Request {
  return new Request("https://app.test/api/meta/data-deletion", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

const ORG = "dd-test-org";

beforeEach(async () => {
  await prisma.actionEvent.deleteMany({ where: { ownerId: ORG } });
  await prisma.metaConnection.deleteMany({ where: { ownerId: ORG } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
  await prisma.organization.create({ data: { id: ORG } });
});

describe("POST /api/meta/data-deletion", () => {
  it("valid signed_request → deletes the matching connection, logs the event, returns url+code", async () => {
    await prisma.metaConnection.create({
      data: { id: "mc-dd-1", ownerId: ORG, metaUserId: "777001", accessTokenEnc: "enc", scope: "ads_read" },
    });

    const res = await POST(post(`signed_request=${encodeURIComponent(signedRequest("777001"))}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.confirmation_code).toBe("string");
    expect(body.confirmation_code.length).toBeGreaterThan(5);
    expect(body.url).toContain("/legal/data-deletion?code=");
    // #489: 真删了 → url 声明 deleted
    expect(body.url).toContain("outcome=deleted");

    // token 真的没了
    expect(await prisma.metaConnection.findFirst({ where: { ownerId: ORG } })).toBeNull();
    // 审计有痕
    const ev = await prisma.actionEvent.findFirst({ where: { ownerId: ORG, type: "meta.data_deletion" } });
    expect(ev).not.toBeNull();
  });

  it("unknown meta user → still 200 with a receipt, but the url says outcome=none, NOT deleted (#489)", async () => {
    const res = await POST(post(`signed_request=${encodeURIComponent(signedRequest("999-no-such-user"))}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.confirmation_code).toBeTruthy();
    expect(body.url).toContain("outcome=none");
    expect(body.url).not.toContain("outcome=deleted");
  });

  it("#489 回归:metaUserId 为 NULL 的行 + 有效签名 → 不得返回「已删除」语义,行保持原样", async () => {
    // NULL 行按精确匹配永远不命中;此前无匹配也返回与删除无差别的 200+code(虚假删除确认)。
    await prisma.metaConnection.create({
      data: { id: "mc-dd-null", ownerId: ORG, metaUserId: null, accessTokenEnc: "enc", scope: "ads_read" },
    });

    const res = await POST(post(`signed_request=${encodeURIComponent(signedRequest("777003"))}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    // url 语义必须是「未找到关联数据」,与「已删除」可区分
    expect(body.url).toContain("outcome=none");
    expect(body.url).not.toContain("outcome=deleted");
    // 什么都没删:NULL 行仍在,token 仍被持有
    expect(await prisma.metaConnection.findUnique({ where: { id: "mc-dd-null" } })).not.toBeNull();
    // 也没有留下「已删除」的审计事件
    const ev = await prisma.actionEvent.findFirst({ where: { ownerId: ORG, type: "meta.data_deletion" } });
    expect(ev).toBeNull();
  });

  it("bad signature → 400, deletes nothing", async () => {
    await prisma.metaConnection.create({
      data: { id: "mc-dd-2", ownerId: ORG, metaUserId: "777002", accessTokenEnc: "enc", scope: "ads_read" },
    });
    const [, payload] = signedRequest("777002").split(".");
    const res = await POST(post(`signed_request=${encodeURIComponent(`AAAA.${payload}`)}`));
    expect(res.status).toBe(400);
    expect(await prisma.metaConnection.findFirst({ where: { ownerId: ORG } })).not.toBeNull();
  });

  it("missing signed_request field → 400", async () => {
    expect((await POST(post("nothing=here"))).status).toBe(400);
  });
});
