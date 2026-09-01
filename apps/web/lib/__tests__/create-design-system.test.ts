import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(__dirname, "../..");

function source(relativePath: string): string {
  return fs.readFileSync(path.join(WEB_ROOT, relativePath), "utf8");
}

describe("Create 入口使用同一套产品设计系统", () => {
  it("开工区只保留设计系统输入组件，不再堆一层 dashboard 卡片", () => {
    const home = source("components/canvas/NorthstarHome.tsx");
    const composer = source("components/start-something/StartSomething.tsx");

    expect(home).not.toContain("CardHeader");
    expect(home).not.toContain("CardContent");
    expect(home).not.toContain("composer-prism");
    expect(composer).toContain("<InputGroup");
    expect(composer).toContain("<InputGroupTextarea");
    expect(composer).toContain("<Field");
    expect(composer).not.toContain("border-line-strong");
  });

  it("Create 是一个极简前门：一个 Otto composer 加 Canvas history", () => {
    const page = source("app/create/page.tsx");
    const home = source("components/canvas/NorthstarHome.tsx");

    expect(home).toContain("max-w-[760px]");
    expect(home).toContain("<StartSomething />");
    expect(home).toContain("Canvas history");
    expect(page).not.toContain("CreateBrowseEntry");
    expect(page).not.toContain("CreateBrowseSections");
    expect(home).not.toContain("Templates");
    expect(home).not.toContain("Discover");
  });

  it("第一句话走同一个原子化 Canvas + Conversation 动作", () => {
    const composer = source("components/start-something/StartSomething.tsx");
    expect(composer).toContain("createCanvasConversation");
    expect(composer).toContain("canvasHref(result.projectId");
    expect(composer).not.toContain("createProject");
  });

  it("最近画布仍使用真实链接与语义列表，不把卡片变成不可访问的点击 div", () => {
    const home = source("components/canvas/NorthstarHome.tsx");
    expect(home).toContain("<ul");
    expect(home).toContain("<li key={project.id}>");
    expect(home).toContain("<Link href={canvasHref(project.id)}>");
  });
});
