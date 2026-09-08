/**
 * turn-reference-draft —— 「这一轮带着什么引用」那一份形状，纯函数这一层。
 *
 * 规格 `docs/specs/creation-engine.md`（**CREATE-A2**）与 `docs/specs/frontend-baseline.md`
 * （**FRONT-A10** / **FRONT-A12**）。触发＝2026-09-08 staging E2E 的 FSE-002／003／004。
 *
 * 三处共用一份形状，这个文件钉的就是那一份形状本身：确认卡怎么变成一轮引用（FSE-003）、
 * 落库消息怎么变回一份重试草稿（FSE-004）、以及它们怎么合成 `.strict()` 请求体收得下的那几格。
 */
import { describe, it, expect } from "vitest";
import {
  EMPTY_TURN_REFERENCES,
  cardReferenceLabels,
  hasTurnReferences,
  mergeTurnReferences,
  restoredReferencesNote,
  turnReferenceBody,
  turnReferenceDraftFromMessage,
  turnReferencesFromCard,
  turnReferencesFromComposerPayload,
} from "@/lib/turn-reference-draft";

const AVATAR = "ent_aisyah";
const IMAGE = "gen_coral_mug";
const CLIP = "gen_clip";

const card = {
  approvedEntities: [{ id: AVATAR, name: "Aisyah" }],
  mediaReferences: [
    { generationId: IMAGE, kind: "image" as const, label: "Coral travel mug" },
    { generationId: CLIP, kind: "video" as const, label: "Shop b-roll" },
  ],
};

describe("FSE-003 / CREATE-A2 —— 确认卡 → 这一轮的引用", () => {
  it("FSE-003 / CREATE-A2 卡上冻着的元素与媒体各归各位（按 kind，不靠 id 形状）", () => {
    expect(turnReferencesFromCard(card)).toEqual({
      entityIds: [AVATAR],
      references: [],
      sourceGenerationIds: [IMAGE],
      referenceVideoGenerationIds: [CLIP],
    });
  });

  it("FSE-003 / CREATE-A2 卡上一件引用都没有 ⇒ 四格全空（不编一件出来）", () => {
    expect(turnReferencesFromCard({})).toEqual(EMPTY_TURN_REFERENCES);
    expect(hasTurnReferences(turnReferencesFromCard({}))).toBe(false);
  });

  it("FSE-003 / CREATE-A1 卡上那几件引用的名字，就是回执上那一份 label", () => {
    expect(cardReferenceLabels(card)).toEqual(["Aisyah", "Coral travel mug", "Shop b-roll"]);
  });
});

describe("FSE-004 / FRONT-A12 —— 落库消息 → 重试草稿", () => {
  const message = {
    id: "msg_failed_turn",
    metadata: {
      durableId: "msg_failed_turn",
      payload: { entityIds: [AVATAR], sourceGenerationIds: [IMAGE], referenceVideoGenerationIds: [] },
      references: [
        { type: "official-avatar", id: AVATAR, name: "Aisyah" },
        { type: "generation", id: IMAGE, name: "Coral travel mug" },
      ],
    },
  };

  it("FSE-004 / FRONT-A12 那句话＋原引用＋源任务标识，一份齐全", () => {
    const draft = turnReferenceDraftFromMessage(message, "make another take with the mug");
    expect(draft.text).toBe("make another take with the mug");
    expect(draft.refs).toEqual({
      entityIds: [AVATAR],
      references: [`official-avatar:${AVATAR}`, `generation:${IMAGE}`],
      sourceGenerationIds: [IMAGE],
      referenceVideoGenerationIds: [],
    });
    expect(draft.labels).toEqual(["Aisyah", "Coral travel mug"]);
    expect(draft.sourceMessageId).toBe("msg_failed_turn");
  });

  it("FSE-004 / FRONT-A12 线程 DTO 那一种形状（引用直接挂在消息上）读法完全相同", () => {
    const draft = turnReferenceDraftFromMessage(
      { id: "msg_failed_turn", payload: message.metadata.payload, references: message.metadata.references },
      "make another take with the mug",
    );
    expect(draft.refs.sourceGenerationIds).toEqual([IMAGE]);
    expect(draft.sourceMessageId).toBe("msg_failed_turn");
  });

  it("FSE-004 / FRONT-A12 那一轮本来就没带引用 ⇒ 草稿只有那句话，不凭空长出一件", () => {
    const draft = turnReferenceDraftFromMessage({ id: "m1" }, "just talk to me");
    expect(draft.refs).toEqual(EMPTY_TURN_REFERENCES);
    expect(restoredReferencesNote(draft)).toBeNull();
  });

  it("FSE-004 / FRONT-A12 那一行说得出名字；只有 id 的那几件报个数，绝不编一个名字", () => {
    expect(restoredReferencesNote({ refs: EMPTY_TURN_REFERENCES, labels: ["Aisyah"] })).toBe(
      "References kept: Aisyah",
    );
    expect(
      restoredReferencesNote({
        refs: { ...EMPTY_TURN_REFERENCES, sourceGenerationIds: [IMAGE, CLIP] },
        labels: [],
      }),
    ).toBe("2 references kept");
  });
});

describe("FSE-002 / CREATE-A2 —— 合流与请求体", () => {
  it("FSE-002 / CREATE-A2 两份合成一份：同一件东西只上一次车", () => {
    const merged = mergeTurnReferences(
      { entityIds: [AVATAR], references: [], sourceGenerationIds: [IMAGE], referenceVideoGenerationIds: [] },
      { entityIds: [AVATAR], references: [], sourceGenerationIds: [IMAGE], referenceVideoGenerationIds: [CLIP] },
    );
    expect(merged.entityIds).toEqual([AVATAR]);
    expect(merged.sourceGenerationIds).toEqual([IMAGE]);
    expect(merged.referenceVideoGenerationIds).toEqual([CLIP]);
  });

  it("FSE-002 / CREATE-A2 附件那一份走 `composerReferencePayload` 的产物，不在这里重算一遍", () => {
    expect(
      turnReferencesFromComposerPayload({ sourceGenerationIds: [IMAGE], referenceVideoGenerationIds: [CLIP] }),
    ).toEqual({
      entityIds: [],
      references: [],
      sourceGenerationIds: [IMAGE],
      referenceVideoGenerationIds: [CLIP],
    });
  });

  it("FSE-002 / CREATE-A2 请求体：空的一格不出现（schema 是 .strict()），单复数并存", () => {
    expect(turnReferenceBody(EMPTY_TURN_REFERENCES)).toEqual({});
    expect(
      turnReferenceBody({
        entityIds: [AVATAR],
        references: [`generation:${IMAGE}`],
        sourceGenerationIds: [IMAGE],
        referenceVideoGenerationIds: [CLIP],
      }),
    ).toEqual({
      entityIds: [AVATAR],
      references: [`generation:${IMAGE}`],
      sourceGenerationId: IMAGE,
      sourceGenerationIds: [IMAGE],
      referenceVideoGenerationId: CLIP,
      referenceVideoGenerationIds: [CLIP],
    });
  });
});
