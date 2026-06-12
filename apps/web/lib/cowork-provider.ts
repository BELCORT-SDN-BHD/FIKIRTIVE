import "server-only";
/**
 * Cowork providers (web-side — the cowork action runs in the web, not the
 * worker). Mirrors the generation provider's mock/real split: MockCoworkProvider
 * is a deterministic $0 draft for dev; FalCoworkProvider calls a fal-hosted LLM
 * (OpenAI-compatible OpenRouter endpoint → Claude, reusing FAL_KEY, no new key).
 * Swapping to a self-hosted model later = one more provider here; nothing else
 * changes (model-neutral by design).
 */
import type { CoworkProvider, CoworkPlan } from "@artlio/core";
import { coworkPlan, COWORK_MAX_SCENES, COWORK_MAX_SHOTS_PER_SCENE } from "@artlio/core";

/** Deterministic, offline storyboard draft — proves the scaffolding at $0. */
export class MockCoworkProvider implements CoworkProvider {
  readonly name = "mock";
  async planStoryboard(idea: string): Promise<CoworkPlan> {
    const subject = idea.trim().replace(/\s+/g, " ").slice(0, 140);
    const beats = [
      "establishing wide shot",
      "medium shot introducing the subject",
      "close-up on a telling detail",
      "an emotional beat / reaction",
      "closing wide shot",
    ];
    return { scenes: [{ title: "Scene 1", shots: beats.map((b) => ({ prompt: `${b} — ${subject}, cinematic lighting` })) }] };
  }
}

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("cowork: no JSON object in the LLM output");
  return JSON.parse(text.slice(start, end + 1));
}

/** Real cowork — a fal-hosted LLM via the OpenAI-compatible OpenRouter endpoint
 *  (reuses FAL_KEY; routes to Claude). LLM output is untrusted → validated/capped. */
export class FalCoworkProvider implements CoworkProvider {
  readonly name = "fal:llm";
  constructor(private apiKey: string) {}
  async planStoryboard(idea: string): Promise<CoworkPlan> {
    const system =
      `You are a film director's assistant. Break the user's idea into a concise storyboard. ` +
      `Respond with ONLY a JSON object, no prose: {"scenes":[{"title":"string","shots":[{"prompt":"string"}]}]}. ` +
      `Each shot "prompt" is a vivid, self-contained visual description (subject, framing, camera, lighting, mood) for an image generator — not dialogue. ` +
      `At most ${COWORK_MAX_SCENES} scenes and ${COWORK_MAX_SHOTS_PER_SCENE} shots per scene. Keep it tight and shootable.`;
    const res = await fetch("https://fal.run/openrouter/router/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Key ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "anthropic/claude-3.5-sonnet",
        messages: [
          { role: "system", content: system },
          { role: "user", content: idea },
        ],
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`fal llm → ${res.status}: ${detail.slice(0, 300)}`);
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return coworkPlan.parse(extractJson(data.choices?.[0]?.message?.content ?? "")) as CoworkPlan;
  }
}

/** Real cowork when FAL_KEY is present, else the deterministic mock ($0 dev). */
export function createCoworkProvider(): CoworkProvider {
  const key = process.env.FAL_KEY;
  return key ? new FalCoworkProvider(key) : new MockCoworkProvider();
}
