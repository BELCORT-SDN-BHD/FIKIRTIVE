import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@fikirtive/db";
import { getConversation, getMemberDirectory } from "../customer-inbox-gateway";

/**
 * #725 follow-up — the Inbox gateway's `getMemberDirectory()` calls a service that runs its OWN
 * `members.read` re-check and signals refusal with `MemberDirectoryError`, not
 * `CustomerInboxError`. The gateway's runRead only mapped the latter, so a refusal escaped as a
 * thrown exception instead of `{ ok: false, error }` — and because the conversation route reads
 * everything through one `Promise.all`, that exception takes the WHOLE page down rather than
 * degrading the one panel that could not load. The broadcast gateway already maps this error
 * explicitly; this test pins the Inbox gateway to the same behaviour.
 *
 * The refusal is reachable in production without any role being misconfigured: the gateway
 * checks `inbox.read` on one membership read and the directory service re-checks `members.read`
 * on a second one, so a membership edited or deactivated between the two lands exactly here.
 * The mock below stands in for that window.
 */
vi.mock("../auth-guard", () => ({
  requireOwner: vi.fn(async () => ({
    email: "inbox-directory-owner@example.test",
    ownerId: "inbox-directory-test-org",
  })),
}));
vi.mock("../better-auth/compat", () => ({
  isImpersonating: vi.fn(async () => false),
}));
vi.mock("../member-directory-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../member-directory-service")>();
  return {
    ...actual,
    memberDirectoryService: {
      listMemberDirectory: vi.fn(async () => {
        throw new actual.MemberDirectoryError("ACTION_DENIED");
      }),
    },
  };
});

const ORG = "inbox-directory-test-org";
const USER = "inbox-directory-test-user";
const MEMBERSHIP = "inbox-directory-test-membership";

async function cleanup(): Promise<void> {
  await prisma.membership.deleteMany({ where: { orgId: ORG } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
  await prisma.user.deleteMany({ where: { id: USER } });
}

beforeEach(async () => {
  await cleanup();
  await prisma.organization.create({ data: { id: ORG } });
  await prisma.user.create({ data: { id: USER, email: "inbox-directory-owner@example.test" } });
  await prisma.membership.create({ data: { id: MEMBERSHIP, userId: USER, orgId: ORG, role: "owner" } });
  await prisma.membershipRole.create({ data: { membershipId: MEMBERSHIP, role: "owner" } });
  vi.clearAllMocks();
});

afterAll(cleanup);

describe("Inbox gateway maps a member-directory refusal instead of throwing", () => {
  it("returns the refusal as a normal failed read", async () => {
    const result = await getMemberDirectory();
    expect(result).toEqual({ ok: false, error: "ACTION_DENIED" });
  });

  it("lets the rest of the conversation route's parallel reads still resolve", async () => {
    // The route awaits every read in one Promise.all. A rejected directory read used to reject
    // the whole batch; a mapped failure lets the conversation itself still render.
    const [conversation, directory] = await Promise.all([
      getConversation({ conversationId: "does-not-exist" }),
      getMemberDirectory(),
    ]);
    expect(conversation).toEqual({ ok: false, error: "RESOURCE_NOT_FOUND" });
    expect(directory).toEqual({ ok: false, error: "ACTION_DENIED" });
  });
});
