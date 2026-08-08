import { describe, expect, it } from "vitest";

import {
  templatePlaceholders,
  templateVariableMismatch,
} from "../message-template-placeholders";

describe("templatePlaceholders", () => {
  it("reads each {{key}} once, in the order it first appears, ignoring spacing", () => {
    expect(templatePlaceholders("Hi {{ name }}, see you at {{shop}}. Bye {{name}}."))
      .toEqual(["name", "shop"]);
  });

  it("finds nothing in a body with no placeholders, and skips an empty pair", () => {
    expect(templatePlaceholders("Our shop is closed this Monday.")).toEqual([]);
    expect(templatePlaceholders("Nothing here {{}} or here {{   }}")).toEqual([]);
  });
});

describe("templateVariableMismatch", () => {
  it("stays silent when both sides agree", () => {
    expect(templateVariableMismatch("Hi {{name}} at {{shop}}", ["name", "shop"])).toBeNull();
    expect(templateVariableMismatch("Closed on Monday.", [])).toBeNull();
  });

  // The reported case: the merchant followed the on-screen {{name}} example but typed a
  // different variable name, and the version saved silently.
  it("names every placeholder the variables list is missing", () => {
    const message = templateVariableMismatch(
      "Hi {{name}}, weekend special at {{shop}}.",
      ["firstName"],
    );
    expect(message).toContain("{{name}} and {{shop}}");
    expect(message).toContain("firstName");
  });

  it("also names a declared variable the message never uses", () => {
    const message = templateVariableMismatch("Hi {{name}}", ["name", "shop"]);
    expect(message).toContain("shop");
    expect(message).toContain("{{shop}}");
  });

  it("reads as one sentence for a single missing placeholder", () => {
    expect(templateVariableMismatch("Hi {{name}}", [])).toBe(
      "The message uses {{name}}, but it isn't in the variables list — add it as key=sample value, or take it out of the message.",
    );
  });
});
