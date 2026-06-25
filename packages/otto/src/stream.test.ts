/**
 * Task 1: Verify the streaming run contract.
 *
 * Approach: a MINIMAL Agent (not otto itself) driven by a fake Model injected
 * via Runner's modelProvider config. This avoids touching the global provider.
 * Tests:
 *   - Runner.run(agent, input, { stream: true }) returns a StreamedRunResult
 *   - iterating it yields at least one "raw_model_stream_event"
 *   - after draining, .state.toString() is a non-empty string
 *
 * We avoid the real otto agent to keep this offline (no API calls).
 */
import { describe, it, expect } from "vitest";
import { Agent, Runner, Usage } from "@openai/agents";
import type {
  Model,
  ModelRequest,
  ModelResponse,
  ModelProvider,
} from "@openai/agents";
import type { StreamEvent } from "@openai/agents";

/** A single assistant message output item. OutputModelItem discriminates on 'type'. */
const assistantMessageOutput = {
  type: "message" as const,
  role: "assistant" as const,
  status: "completed" as const,
  content: [{ type: "output_text" as const, text: "hi" }],
};

const fakeUsage = new Usage({ inputTokens: 1, outputTokens: 1, totalTokens: 2 });

/** Minimal fake model: yields one output_text_delta then a response_done. */
const fakeModel: Model = {
  async getResponse(_request: ModelRequest): Promise<ModelResponse> {
    return {
      usage: fakeUsage,
      output: [assistantMessageOutput],
    };
  },
  async *getStreamedResponse(
    _request: ModelRequest,
  ): AsyncIterable<StreamEvent> {
    // A text delta — surfaces as a raw_model_stream_event when emitted by run().
    yield { type: "output_text_delta", delta: "hi" } satisfies StreamEvent;
    // response_done signals end of response and carries usage + final output.
    yield {
      type: "response_done",
      response: {
        id: "fake-resp-id",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        output: [assistantMessageOutput],
      },
    } satisfies StreamEvent;
  },
};

const fakeProvider: ModelProvider = {
  getModel(_modelName?: string): Model {
    return fakeModel;
  },
};

/** Minimal agent — model resolved by fakeProvider via Runner config. */
const minimalAgent = new Agent({
  name: "FakeStreamAgent",
  instructions: "Reply hi.",
});

/** Runner scoped to the fake provider — never hits the network. */
const runner = new Runner({
  modelProvider: fakeProvider,
  tracingDisabled: true,
  traceIncludeSensitiveData: false,
});

describe("streaming run contract (fake model)", () => {
  it("yields at least one raw_model_stream_event and state.toString() is non-empty", async () => {
    const result = await runner.run(minimalAgent, "hello", {
      stream: true,
    });

    const events: string[] = [];
    for await (const event of result) {
      events.push(event.type);
    }

    // Must include at least one raw model stream event.
    expect(events).toContain("raw_model_stream_event");

    // After draining, .state must serialise to a non-empty string.
    const stateStr = result.state.toString();
    expect(typeof stateStr).toBe("string");
    expect(stateStr.length).toBeGreaterThan(0);
  });
});
