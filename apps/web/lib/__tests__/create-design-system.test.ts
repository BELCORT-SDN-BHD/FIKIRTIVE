import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(__dirname, "../..");

function source(relativePath: string): string {
  return fs.readFileSync(path.join(WEB_ROOT, relativePath), "utf8");
}

// FRONT §7.1 ⑨:Create 起步页搬到已批准的设计夹具上,这份守卫跟着换成
// `components/start-something/CreateWorkspace.tsx`。三条主张一字未改 ——
// 只用设计系统输入组件、一个 composer 加一段 Canvas history、真链接与语义列表;
// 页面宽度改成夹具的 920px 页栏 + 680px 内容栏。
describe("Create 入口使用同一套产品设计系统", () => {
  it("开工区只保留设计系统输入组件，不再堆一层 dashboard 卡片", () => {
    const workspace = source("components/start-something/CreateWorkspace.tsx");
    const composer = source("components/start-something/StartSomething.tsx");

    expect(workspace).not.toContain("CardHeader");
    expect(workspace).not.toContain("CardContent");
    expect(workspace).not.toContain("composer-prism");
    expect(composer).toContain("<InputGroup");
    expect(composer).toContain("<InputGroupTextarea");
    expect(composer).toContain("<Field");
    expect(composer).not.toContain("border-line-strong");
  });

  it("Create 是一个极简前门：一个 Otto composer 加 Canvas history", () => {
    const page = source("app/create/page.tsx");
    const workspace = source("components/start-something/CreateWorkspace.tsx");

    expect(workspace).toContain("max-w-[920px]");
    expect(workspace).toContain("max-w-[680px]");
    expect(workspace).toContain("<StartSomething />");
    expect(workspace).toContain("Canvas history");
    expect(page).not.toContain("CreateBrowseEntry");
    expect(page).not.toContain("CreateBrowseSections");
    expect(workspace).not.toContain("Templates");
    expect(workspace).not.toContain("Discover");
  });

  it("第一句话走同一个原子化 Canvas + Conversation 动作", () => {
    const composer = source("components/start-something/StartSomething.tsx");
    expect(composer).toContain("createCanvasConversation");
    expect(composer).toContain("canvasHref(result.projectId");
    expect(composer).not.toContain("createProject");
  });

  it("最近画布仍使用真实链接与语义列表，不把卡片变成不可访问的点击 div", () => {
    const workspace = source("components/start-something/CreateWorkspace.tsx");
    expect(workspace).toContain("<ul");
    expect(workspace).toContain("<li key={project.id}");
    expect(workspace).toContain("<Link href={canvasHref(project.id)}");
  });
});
