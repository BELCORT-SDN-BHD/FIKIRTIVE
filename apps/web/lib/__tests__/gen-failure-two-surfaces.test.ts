/**
 * gen-failure-two-surfaces.test.ts — #765: ONE sentence, both places the merchant can be.
 *
 * The worker writes the merchant's explanation onto the job row (proved by
 * apps/worker/src/jobs/gen-reference-person.test.ts). This file is about what happens to it
 * afterwards, on the two paths a merchant can reach a generation from:
 *
 *   · the CREATION SURFACE — they pressed generate on the board, there is no chat to post
 *     into, and the card's own poll is the only thing that will ever tell them anything;
 *   · OTTO — they asked in the conversation, and when they follow up ("what happened?") Otto
 *     must be able to say the same thing rather than "it didn't go through".
 *
 * The failure this pins shut is DRIFT: two surfaces each inventing their own wording for the
 * same event, so the merchant is told two different stories about one refusal. Both read the
 * same core whitelist, and the assertions below compare against that constant, not against a
 * copy of the words.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { REFERENCE_IMAGE_PERSON_REJECTED } from "@fikirtive/core";

const m = vi.hoisted(() => ({ createCanvasNode: vi.fn(), getGenJob: vi.fn(), startCanvasGen: vi.fn() }));
vi.mock("../canvas-actions", () => ({ createCanvasNode: m.createCanvasNode }));
vi.mock("../gen-actions", () => ({ getGenJob: m.getGenJob, startCanvasGen: m.startCanvasGen }));

import { poll } from "../../components/canvas/useCanvasGen";
import { buildContextSystemMessage } from "../otto-actions";

beforeEach(() => vi.clearAllMocks());

const cancelled = { current: false };

describe("ENTRY creation surface — the card's poll passes the explanation on", () => {
  it("hands the merchant the sentence when the job carries one", async () => {
    m.getGenJob.mockResolvedValue({ status: "FAILED", urls: [], generationIds: [], guidance: REFERENCE_IMAGE_PERSON_REJECTED });
    const onFailure = vi.fn();
    const onDone = vi.fn();

    await poll("j", onDone, cancelled, { intervalMs: 0, maxPolls: 5, onFailure });

    expect(onFailure).toHaveBeenCalledWith(REFERENCE_IMAGE_PERSON_REJECTED);
    // The card still reaches its ordinary terminal face — the explanation is in addition to
    // that ending, not instead of it.
    expect(onDone).toHaveBeenCalledWith([], "failed", []);
  });

  it("stays quiet for an ordinary failure — there is nothing useful to add", async () => {
    // The card already says "You weren't charged. Try again." A second, contentless message on
    // top of it is noise, and noise trains merchants to ignore the one that matters.
    m.getGenJob.mockResolvedValue({ status: "FAILED", urls: [], generationIds: [], guidance: null });
    const onFailure = vi.fn();

    await poll("j", vi.fn(), cancelled, { intervalMs: 0, maxPolls: 5, onFailure });

    expect(onFailure).not.toHaveBeenCalled();
  });

  it("says nothing on a cancel or a client-side give-up", async () => {
    for (const status of ["CANCELLED", "RUNNING"]) {
      m.getGenJob.mockResolvedValue({ status, urls: [], generationIds: [], guidance: REFERENCE_IMAGE_PERSON_REJECTED });
      const onFailure = vi.fn();
      await poll("j", vi.fn(), cancelled, { intervalMs: 0, maxPolls: 2, onFailure });
      expect(onFailure).not.toHaveBeenCalled();
    }
  });
});

describe("ENTRY Otto — the assistant can answer the follow-up with the same sentence", () => {
  /** What Otto is told about the last generation in this conversation. */
  const statusLine = (activeJob: { status: string; kind: string; error?: string | null }): string => {
    const message = buildContextSystemMessage({ orgId: "o1", userId: "o1", projectId: "p1", threadId: "t1", activeJob });
    return String((message as { content?: unknown } | null)?.content ?? "");
  };

  it("carries the reason, word for word, when the job has one", async () => {
    const line = statusLine({ status: "FAILED", kind: "VIDEO", error: REFERENCE_IMAGE_PERSON_REJECTED });

    expect(line).toContain("Current generation status");
    expect(line).toContain(REFERENCE_IMAGE_PERSON_REJECTED);
    // Still true, and still said: the refund is not replaced by the explanation.
    expect(line).toContain("NOT charged");
  });

  it("never hands Otto an internal error string to relay", async () => {
    // GenJob.error is an ops column too. Otto reads the same whitelist as everything else, so
    // a line like this reaches it as nothing at all.
    const line = statusLine({ status: "FAILED", kind: "IMAGE", error: "conditioning refs unreachable (0/1) — refusing to spend" });

    expect(line).toContain("the last generation FAILED");
    expect(line).not.toContain("conditioning refs");
  });

  it("leaves every other status alone", async () => {
    for (const status of ["DONE", "GENERATING", "QUEUED", "CANCELLED"]) {
      const line = statusLine({ status, kind: "VIDEO", error: REFERENCE_IMAGE_PERSON_REJECTED });
      expect(line).not.toContain(REFERENCE_IMAGE_PERSON_REJECTED);
    }
  });
});
