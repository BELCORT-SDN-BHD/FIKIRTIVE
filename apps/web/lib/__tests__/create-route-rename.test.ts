/**
 * Frozen Create IA: old bookmarks still land on the canonical routes, while `/create` itself is
 * only the Otto entry plus Canvas history. Templates/Discover are no longer rendered here.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SHELL_ROUTES } from "@fikirtive/core/navigation";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const source = (file: string) => readFileSync(resolve(WEB_ROOT, file), "utf8");

afterEach(() => vi.clearAllMocks());

const RENAMES = [
  { route: "app/northstar-immersive/page.tsx", to: SHELL_ROUTES.create },
  { route: "app/northstar-immersive/create/canvas/page.tsx", to: SHELL_ROUTES.canvas },
  { route: "app/northstar-immersive/[...retired]/page.tsx", to: SHELL_ROUTES.create },
] as const;

describe("legacy Create routes", () => {
  it.each(RENAMES)("$route still exists", ({ route }) => {
    expect(existsSync(resolve(WEB_ROOT, route))).toBe(true);
  });

  it.each(RENAMES)("$route preserves deep-link parameters", async ({ route, to }) => {
    const mod = await import(/* @vite-ignore */ resolve(WEB_ROOT, route));
    await expect(mod.default({
      searchParams: Promise.resolve({
        project: "p-1",
        thread: "t-1",
        persona: ["face-1", "face-2"],
      }),
    })).rejects.toThrow(
      `NEXT_REDIRECT:${to}?project=p-1&thread=t-1&persona=face-1&persona=face-2`,
    );
  });
});

// FRONT §7.1 ⑨ moved the Create start page onto the approved design fixture, so the surface it
// pins is now `components/start-something/CreateWorkspace{,Entry}.tsx` instead of the canvas tree's
// NorthstarHome pair. The claims themselves are unchanged: one controlled entry, one real composer
// action, one Canvas history, authentication at the server adapter.
describe("frozen Create surface", () => {
  it("renders the controlled Create entry and no browse homepage", () => {
    const page = source("app/create/page.tsx");
    expect(page).toContain("CreateWorkspaceEntry");
    expect(page).not.toContain("CreateBrowseEntry");
    expect(page).not.toContain("CreateBrowseSections");
  });

  it("has one real composer action and one Canvas history", () => {
    const workspace = source("components/start-something/CreateWorkspace.tsx");
    const composer = source("components/start-something/StartSomething.tsx");
    expect(workspace).toContain("<StartSomething />");
    expect(workspace).toContain("Canvas history");
    expect(composer).toContain("createCanvasConversation");
    expect(composer).not.toContain("createProject");
  });

  it("keeps authentication at the controlled server entry", () => {
    const entry = source("components/start-something/CreateWorkspaceEntry.tsx");
    expect(entry).toContain("requireOwner()");
    expect(entry).toContain('redirect("/login")');
    expect(entry).toContain("getProjects(owner.ownerId)");
  });
});
