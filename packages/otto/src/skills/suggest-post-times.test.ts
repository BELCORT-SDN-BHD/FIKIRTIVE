import { it, expect, vi } from "vitest";
import { suggestPostTimesSkill, executeSuggestPostTimes } from "./suggest-post-times.js";

it("gate: free/read/internal → ungated", () => {
  expect(suggestPostTimesSkill.cost).toBe("free");
  expect(suggestPostTimesSkill.effect).toBe("read");
  expect(suggestPostTimesSkill.reach).toBe("internal");
  expect(suggestPostTimesSkill.needsApproval).toBe(false);
});

it("reads suggestions from the port and passes channel + limit through (read-only, no write path)", async () => {
  const suggestTimes = vi.fn(async () => [
    { dayOfWeek: 3, hourUtc: 19, score: 90, rationale: "midweek evening scroll peak" },
    { dayOfWeek: 3, hourUtc: 11, score: 85, rationale: "midweek late-morning peak" },
  ]);
  // The port exposes ONLY suggestTimes here — there is no write method to reach.
  const res: any = await executeSuggestPostTimes(
    { channel: "instagram", limit: 2 },
    { context: { schedule: { suggestTimes } } as any },
  );
  expect(suggestTimes).toHaveBeenCalledWith({ channel: "instagram", limit: 2 });
  expect(res.suggestions).toHaveLength(2);
  expect(res.suggestions[0].score).toBe(90);
});

it("degrades gracefully when the port is missing", async () => {
  const res: any = await executeSuggestPostTimes({ channel: "instagram" }, { context: {} as any });
  expect(res.error).toBeTruthy();
});
