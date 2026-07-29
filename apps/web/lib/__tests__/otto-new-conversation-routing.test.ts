/**
 * otto-new-conversation-routing.test.ts — wiring tests for two Otto entry flows
 * from #513 group D (New campaign direct-build-direct-enter, and the always-visible
 * header "New conversation" button).
 *
 * NOTE: apps/web has NO React component test harness (vitest environment is "node",
 * no jsdom/@testing-library/react — see otto-ui-messages.test.ts). Following the
 * established pattern in workflow-ui-wiring.test.ts, these tests read the actual
 * component source and assert the literal wiring, rather than re-deriving the
 * logic in a parallel implementation that could drift from the real code.
 *
 * Regression this locks down: the header "New conversation" button was wired to
 * `onNewConvo={() => setActiveThreadId(null)}` — a bare local-state reset that
 * never touched the URL. On refresh, `/otto?...&thread=<old>` was still in the
 * address bar, so the server re-opened the stale thread (app/otto/page.tsx).
 * The fix routes the button through the SAME `handleNewChat` chain the sidebar's
 * "New chat" entry already used, which pushes `?new=1` into the URL.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(__dirname, relativePath), "utf8");
}

describe("Otto header \"New conversation\" routing", () => {
  it("wires the header button to handleNewChat's URL-aware route, not a bare state reset", () => {
    const app = source("../../components/otto/OttoApp.tsx");

    // The regression: this exact bare reset must never come back.
    expect(app).not.toContain("onNewConvo={() => setActiveThreadId(null)}");
    // The fix: same chain as the sidebar's existing "New chat" entry.
    expect(app).toContain("onNewConvo={() => handleNewChat(curProjectId)}");
  });

  it("keeps handleNewChat pushing the ?new=1 route for the current project (not only resetting state)", () => {
    const app = source("../../components/otto/OttoApp.tsx");

    expect(app).toContain("const handleNewChat = useCallback((projId: string) => {");
    expect(app).toContain("if (projId === curProjectId) {");
    expect(app).toContain("setActiveThreadId(null);");
    expect(app).toContain("pushLocalRoute(projectHref(projId, undefined, { newChat: true }));");
    // Cross-project new chat still goes through a real navigation with the same flag.
    expect(app).toContain("router.push(projectHref(projId, undefined, { newChat: true }));");
  });

  it("only sets the new=1 query flag when no thread id is present (thread wins over newChat)", () => {
    const app = source("../../components/otto/OttoApp.tsx");

    expect(app).toContain('if (threadId) p.set("thread", threadId);');
    expect(app).toContain('if (opts?.newChat && !threadId) p.set("new", "1");');
  });

  it("propagates the button through OttoView unchanged into OttoChatStream's header", () => {
    const view = source("../../components/otto/OttoView.tsx");
    const chatStream = source("../../components/otto/OttoChatStream.tsx");

    expect(view).toContain("onNewConversation={onNewConvo}");
    expect(chatStream).toContain("onClick={onNewConversation}");
    expect(chatStream).toContain("New conversation");
  });

  it("makes the server route honor ?new=1 by refusing to reopen a stale ?thread= id", () => {
    const page = source("../../app/otto/page.tsx");

    expect(page).toContain('const forceNewThread = sp?.new === "1";');
    expect(page).toContain("const openThreadId = forceNewThread");
    expect(page).toContain("? undefined");
    expect(page).toContain("initialActiveThreadId={openThreadId ?? null}");
  });
});

describe("Otto \"New campaign\" direct-build-direct-enter", () => {
  it("creates the campaign with the fixed default name and navigates straight into it on success", () => {
    const app = source("../../components/otto/OttoApp.tsx");

    expect(app).toContain('const res = await createProject("New campaign");');
    expect(app).toContain('if (res && "id" in res) {');
    // Bare project href — no stale thread= or new= carried over from the current URL.
    expect(app).toContain("window.location.assign(projectHref(res.id));");
    expect(app).not.toContain("window.location.assign(projectHref(res.id, undefined");
  });

  it("guards against a double-submit while the campaign create is in flight", () => {
    const app = source("../../components/otto/OttoApp.tsx");

    expect(app).toContain("const handleNewCampaign = useCallback(async () => {");
    expect(app).toContain("if (newCampaignPendingRef.current) return false;");
    expect(app).toContain("newCampaignPendingRef.current = true;");
    expect(app).toContain("newCampaignPendingRef.current = false;");
  });

  it("sends the user back to sign-in (not a dead campaign click) when the session has expired", () => {
    const app = source("../../components/otto/OttoApp.tsx");

    expect(app).toContain('const loginHref = `/login?from=${encodeURIComponent(projectHref(curProjectId))}`;');
    expect(app).toContain("window.location.assign(loginHref);");
  });
});
