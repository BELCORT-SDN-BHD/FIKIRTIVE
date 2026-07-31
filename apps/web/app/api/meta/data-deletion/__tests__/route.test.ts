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
  // The zero-match trail is platform-level, so it hangs off the seed "founder" org
  // (route.ts's meta.data_deletion.nomatch create). Ensure it exists — that write is
  // best-effort and would silently vanish without the org, which is exactly the honesty
  // gap #573 is closing. Never deleted here: it is the real seed org, not a fixture.
  await prisma.organization.upsert({ where: { id: "founder" }, create: { id: "founder" }, update: {} });
});

/** The nomatch audit row for one specific callback, found by its confirmation code. */
async function findNoMatchEvent(confirmationCode: string) {
  const rows = await prisma.actionEvent.findMany({
    where: { ownerId: "founder", type: "meta.data_deletion.nomatch" },
  });
  return rows.find((r) => (r.payload as { confirmationCode?: string } | null)?.confirmationCode === confirmationCode) ?? null;
}

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

    // token 真的没了
    expect(await prisma.metaConnection.findFirst({ where: { ownerId: ORG } })).toBeNull();
    // 审计有痕
    const ev = await prisma.actionEvent.findFirst({ where: { ownerId: ORG, type: "meta.data_deletion" } });
    expect(ev).not.toBeNull();
    // #573: a real deletion is NOT logged as a no-match — the two trails stay distinct.
    expect(await findNoMatchEvent(body.confirmation_code)).toBeNull();
  });

  it("unknown meta user → still 200 with confirmation (nothing to delete is a valid outcome)", async () => {
    const res = await POST(post(`signed_request=${encodeURIComponent(signedRequest("999-no-such-user"))}`));
    expect(res.status).toBe(200);
    expect((await res.json()).confirmation_code).toBeTruthy();
  });

  it("#573: zero matches still returns a code, but the audit row says matched:0", async () => {
    // Meta's spec wants the callback idempotent, so "nothing to delete" must still answer
    // with a confirmation code. What must never happen is a code with no honest trail: the
    // platform-level row has to state, in the payload, that this confirmation covers zero
    // deleted connections rather than leaving that to be inferred from the event type.
    const res = await POST(post(`signed_request=${encodeURIComponent(signedRequest("999-nobody-573"))}`));
    expect(res.status).toBe(200);
    const { confirmation_code: code } = await res.json();
    expect(code).toBeTruthy();

    const ev = await findNoMatchEvent(code);
    expect(ev).not.toBeNull();
    expect(ev!.payload).toMatchObject({ metaUserId: "999-nobody-573", confirmationCode: code, matched: 0 });
  });

  it("#573: a legacy connection with metaUserId=null is not matched and is not deleted", async () => {
    // Rows like this can no longer be created (lib/meta-actions.ts refuses to store a
    // connection without the id), but any that predate the fix stay invisible to this exact
    // match. The callback must then report matched:0 rather than imply it cleaned up.
    await prisma.metaConnection.create({
      data: { id: "mc-dd-null", ownerId: ORG, metaUserId: null, accessTokenEnc: "enc", scope: "ads_read" },
    });
    const res = await POST(post(`signed_request=${encodeURIComponent(signedRequest("777003"))}`));
    expect(res.status).toBe(200);
    const { confirmation_code: code } = await res.json();

    expect(await prisma.metaConnection.findUnique({ where: { id: "mc-dd-null" } })).not.toBeNull();
    expect((await findNoMatchEvent(code))!.payload).toMatchObject({ matched: 0 });
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
