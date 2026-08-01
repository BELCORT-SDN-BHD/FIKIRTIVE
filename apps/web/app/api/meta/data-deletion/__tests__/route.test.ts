/**
 * /api/meta/data-deletion 集成测试(真库)——Meta App Review 的合规前置。
 * Meta POST form-encoded signed_request;有效 → 删除匹配的 MetaConnection(加密
 * token 一并消失)+ 记 ActionEvent + 返回 {url, confirmation_code};无效 → 400。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
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
// A second, unrelated merchant. Every deletion below is checked against this one too: the
// callback carries no session, so the only thing standing between one merchant's deletion
// request and another merchant's tokens is the metaUserId match.
const ORG2 = "dd-test-org-2";

beforeEach(async () => {
  for (const org of [ORG, ORG2]) {
    await prisma.actionEvent.deleteMany({ where: { ownerId: org } });
    await prisma.metaConnection.deleteMany({ where: { ownerId: org } });
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.organization.create({ data: { id: org } });
  }
  // The zero-match trail is platform-level, so it hangs off the seed "founder" org
  // (route.ts's meta.data_deletion.nomatch create). Ensure it exists — without the org that
  // write fails, and the callback now refuses to issue a confirmation code it cannot back
  // with a trail. Never deleted here: it is the real seed org, not a fixture.
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

  it("#573: two merchants, different Meta users — only the one who asked is deleted", async () => {
    // This callback is authenticated by the HMAC alone: no session, no ownerId from the
    // caller. So "whose data is this" is decided entirely by the metaUserId match, and the
    // proof that it holds is the untouched neighbour — same table, same request, different
    // Meta user, still connected afterwards.
    await prisma.metaConnection.create({
      data: { id: "mc-dd-t1", ownerId: ORG, metaUserId: "777100", accessTokenEnc: "enc-a", scope: "ads_read" },
    });
    await prisma.metaConnection.create({
      data: { id: "mc-dd-t2", ownerId: ORG2, metaUserId: "777200", accessTokenEnc: "enc-b", scope: "ads_read" },
    });

    const res = await POST(post(`signed_request=${encodeURIComponent(signedRequest("777100"))}`));
    expect(res.status).toBe(200);

    expect(await prisma.metaConnection.findUnique({ where: { id: "mc-dd-t1" } })).toBeNull();
    expect(await prisma.metaConnection.findUnique({ where: { id: "mc-dd-t2" } })).not.toBeNull();
    // The bystander's workspace is not written to at all — no deletion, and no audit row
    // implying something happened in it.
    expect(await prisma.actionEvent.findFirst({ where: { ownerId: ORG2 } })).toBeNull();
    expect(await prisma.actionEvent.findFirst({ where: { ownerId: ORG, type: "meta.data_deletion" } })).not.toBeNull();
  });

  it("#573: one Meta user connected to two workspaces — every connection goes, each workspace gets its own audit row", async () => {
    // The other half of the same boundary. One person can connect the same Meta account to
    // more than one workspace they own, and a deletion request covers all of them — stopping
    // at the first match would leave live tokens behind under a confirmation code that says
    // otherwise.
    await prisma.metaConnection.create({
      data: { id: "mc-dd-m1", ownerId: ORG, metaUserId: "777300", accessTokenEnc: "enc-a", scope: "ads_read" },
    });
    await prisma.metaConnection.create({
      data: { id: "mc-dd-m2", ownerId: ORG2, metaUserId: "777300", accessTokenEnc: "enc-b", scope: "ads_read" },
    });

    const res = await POST(post(`signed_request=${encodeURIComponent(signedRequest("777300"))}`));
    expect(res.status).toBe(200);
    const { confirmation_code: code } = await res.json();

    expect(await prisma.metaConnection.findUnique({ where: { id: "mc-dd-m1" } })).toBeNull();
    expect(await prisma.metaConnection.findUnique({ where: { id: "mc-dd-m2" } })).toBeNull();
    for (const [org, connectionId] of [[ORG, "mc-dd-m1"], [ORG2, "mc-dd-m2"]] as const) {
      const ev = await prisma.actionEvent.findFirst({ where: { ownerId: org, type: "meta.data_deletion" } });
      expect(ev, `${org} must be able to see this deletion in its own trail`).not.toBeNull();
      expect(ev!.payload).toMatchObject({ metaUserId: "777300", connectionId, confirmationCode: code });
    }
    // Two real deletions are never also filed as a no-match.
    expect(await findNoMatchEvent(code)).toBeNull();
  });

  it("#573: an audit write that fails returns a retryable 5xx and NO confirmation code", async () => {
    // The confirmation code is the merchant's receipt: it says this request is on record and
    // can be looked up later. If the record can't be written — the founder org is missing, the
    // database is down — then handing out a code invents a trail that does not exist. Meta
    // retries 5xx, so failing closed here costs a retry and buys an honest audit.
    const spy = vi
      .spyOn(prisma.actionEvent, "create")
      .mockRejectedValueOnce(new Error("audit store unavailable"));
    try {
      const res = await POST(post(`signed_request=${encodeURIComponent(signedRequest("999-audit-down"))}`));
      expect(res.status).toBeGreaterThanOrEqual(500);
      expect((await res.json()).confirmation_code).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
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
