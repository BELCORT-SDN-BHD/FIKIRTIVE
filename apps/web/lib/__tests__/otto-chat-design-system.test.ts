import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(__dirname, "../..");
const source = (file: string) => readFileSync(path.join(WEB_ROOT, file), "utf8");

describe("Otto chat design system", () => {
  it("uses shadcn to own scrolling, anchoring, rows, and bubbles", () => {
    const stream = source("components/otto/OttoChatStream.tsx");
    const textPart = source("components/otto/parts/TextPart.tsx");

    expect(stream).toContain("<MessageScrollerProvider autoScroll>");
    expect(stream).toContain("<MessageScrollerViewport>");
    expect(stream).toContain("<MessageScrollerContent");
    expect(stream).toContain("<MessageScrollerButton variant=\"secondary\" />");
    expect(stream).toContain("<MessageScrollerItem");
    expect(stream).not.toContain("useStickToBottom");
    expect(stream).not.toContain("Scroll to bottom");

    expect(textPart).toContain("<Message align=");
    expect(textPart).toContain("<Bubble");
    expect(textPart).toContain('variant={isUser ? "default" : "outline"}');
    expect(textPart).not.toContain("var(--brand-strong)");
  });

  it("keeps cards, progress, and failures inside the same conversation hierarchy", () => {
    const stream = source("components/otto/OttoChatStream.tsx");
    const status = source("components/otto/parts/StatusLine.tsx");
    const failure = source("components/otto/OttoStreamErrorNotice.tsx");

    for (const match of stream.matchAll(/<WidgetRow\b([^>]*)>/g)) {
      expect(match[1]).toContain("messageId=");
    }
    expect(stream).toContain("<ConversationItem messageId=\"live-status\">");
    expect(stream).toContain("<ConversationItem messageId=\"live-stream-error\">");
    expect(status).toContain('<Bubble variant="status">');
    expect(failure).toContain('<Alert role="alert" variant="destructive"');
  });

  it("uses the attachment primitive for composer upload and reference states", () => {
    const stream = source("components/otto/OttoChatStream.tsx");
    expect(stream).toContain("<AttachmentGroup");
    expect(stream).toContain('<Attachment state="uploading"');
    expect(stream).toContain('<AttachmentMedia variant="image">');
    expect(stream).toContain("<AttachmentAction");
    expect(stream).toContain('Reference couldn&apos;t be attached');
  });

  it("shares this one transcript between the main experience and the side panel", () => {
    const panel = source("components/otto/panel/OttoPanelConversation.tsx");
    expect(panel).toContain('import { OttoChatStream } from "@/components/otto/OttoChatStream"');
    expect(panel).toContain("<OttoChatStream");
  });

  it("uses that same transcript in Canvas with separate current turn, history and composer placement", () => {
    const overlay = source("components/canvas/CanvasOttoOverlay.tsx");
    const stream = source("components/otto/OttoChatStream.tsx");
    // 2026-09-04 走查 P0-3/P0-4:那张始终可见的当前回合卡搬进了自己的组件,因为它现在装得下
    // 确认位(方案摘要 + 价格 + Generate)与真进度。挂点没变(画布形态由这块对话渲染它),
    // 所以这一条钉的还是同一件事,只是钉在它现在住的文件上。
    const turnCard = source("components/otto/OttoTurnCard.tsx");
    const frontDoor = source("components/otto/OttoFrontDoor.tsx");

    expect(overlay).toContain("<OttoChatStream");
    expect(overlay).toContain('layout="canvas"');
    expect(overlay).toContain("<OttoFrontDoor");
    expect(stream).toContain("<OttoTurnCard");
    expect(turnCard).toContain('aria-label="Otto current turn"');
    expect(turnCard).toContain('aria-label="Generation confirmation"');
    expect(stream).toContain("Conversation");
    expect(stream).toContain("Load earlier messages");
    expect(frontDoor).toContain('layout === "canvas"');
  });

  it("uses the shadcn composer and the conventional, IME-safe keyboard model", () => {
    const stream = source("components/otto/OttoChatStream.tsx");
    const frontDoor = source("components/otto/OttoFrontDoor.tsx");
    const pkg = source("package.json");

    expect(stream).toContain("<InputGroupTextarea");
    expect(stream).not.toContain('import { Textarea } from "@/components/ui/textarea"');
    expect(stream).toContain('e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing');
    expect(stream).toContain("Enter to send");
    expect(stream).toContain("submitLockRef.current");
    expect(frontDoor).toContain("<InputGroupTextarea");
    expect(frontDoor).toContain('e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing');
    expect(frontDoor).toContain("Enter to send");
    expect(pkg).not.toContain("use-stick-to-bottom");
  });

  it("keeps the front-door goal actions neutral and reserves coral for Otto", () => {
    const frontDoor = source("components/otto/OttoFrontDoor.tsx");
    const goalStart = frontDoor.indexOf("{/* Goal starters");
    const goalEnd = frontDoor.indexOf("{/* Quick brief */}");
    const goalSurface = frontDoor.slice(goalStart, goalEnd);

    expect(goalStart).toBeGreaterThan(-1);
    expect(goalEnd).toBeGreaterThan(goalStart);
    expect(frontDoor).toContain("icon: LucideIcon");
    expect(frontDoor).toContain("icon: ShoppingBag");
    expect(goalSurface).toContain('variant="secondary"');
    expect(goalSurface).toContain('data-icon="inline-start"');
    expect(goalSurface).toContain('data-icon="inline-end"');
    expect(goalSurface).not.toMatch(/(?:bg|text|border)-brand|variant="otto/);
  });

  it("promotes approval and balance truth into readable shadcn notices", () => {
    const frontDoor = source("components/otto/OttoFrontDoor.tsx");

    expect(frontDoor).toContain('<Alert role="status" variant="warning" density="compact">');
    expect(frontDoor).toContain("<AlertTitle>Low balance for video</AlertTitle>");
    expect(frontDoor).toContain("<AlertTitle>You stay in control</AlertTitle>");
    expect(frontDoor).toContain("{CHAT_SPEND_NOTE}");
    expect(frontDoor).toContain("{CHAT_HOLD_NOTE}");
    expect(frontDoor).not.toContain("text-muted-foreground/70");
  });
});
