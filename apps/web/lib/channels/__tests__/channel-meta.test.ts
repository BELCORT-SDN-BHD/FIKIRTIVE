import { describe, it, expect } from "vitest";
import { CHANNEL_META, channelMeta } from "../channel-meta";
import { listChannels, getChannel } from "../registry";

// channel-meta is the CLIENT-SAFE mirror of the (server-tainted) adapter registry.
// This guards against drift: if an adapter's label/capabilities change, the mirror
// must change too, or the UI silently gates the wrong post types / media caps.
describe("channel-meta mirrors the adapter registry", () => {
  it("covers exactly the registered channels", () => {
    const metaIds = CHANNEL_META.map((c) => c.id).sort();
    const regIds = listChannels().map((c) => c.id).sort();
    expect(metaIds).toEqual(regIds);
  });

  it("label + capabilities match each adapter", () => {
    for (const m of CHANNEL_META) {
      const adapter = getChannel(m.id)!;
      expect(m.label).toBe(adapter.label);
      expect(m.capabilities).toEqual(adapter.capabilities);
    }
  });

  it("channelMeta looks up by id and returns undefined for unknown", () => {
    expect(channelMeta("instagram")?.label).toBe("Instagram");
    expect(channelMeta("nope")).toBeUndefined();
  });
});
