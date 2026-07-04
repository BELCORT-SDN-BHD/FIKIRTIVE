/**
 * ingestProduct — $0 external-read skill (P1-01)
 *
 * The Otto side of "add a product from a link". Reaches the web ONLY through the injected
 * ctx.productIngest port (never fetch()/product-extract directly — ctx-port rule). The port
 * returns a DETERMINISTIC draft (JSON-LD/OG/title) plus the page text. Otto fills any gaps
 * from that text using its own reasoning — that is this path's "Layer 2", so the skill makes
 * no separate LLM call and stays free.
 *
 * Gate: cost:"free" + effect:"read" + reach:"external" → needsApproval = false.
 * effect is "read": the skill returns a draft and never writes — the user confirms and Otto
 * then calls saveProduct (a separate write) to persist.
 */
import type { RunContext } from "@openai/agents";
import { z } from "zod";
import { defineOttoSkill } from "../skill.js";
import type { OttoContext } from "../context.js";

export const ingestProductInput = z.object({
  url: z.string().url().describe("The product page URL to read (e.g. a Shopee/Lazada or store product link)."),
});

type IngestProductInput = z.infer<typeof ingestProductInput>;

export async function executeIngestProduct(
  input: IngestProductInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<unknown> {
  const context = runContext.context as OttoContext;

  if (!context.productIngest) {
    return {
      error: "Reading product links isn't available here — ask the user for the product details directly.",
    };
  }

  const res = await context.productIngest.fromUrl(input.url);
  if ("error" in res) return { error: res.error };

  return {
    draft: res.draft,
    pageText: res.text,
    note:
      "This is a DRAFT read from the page. Confirm the details with the user, filling any missing " +
      "fields from pageText, then save it with saveProduct. Never invent a price or facts not present " +
      "on the page.",
  };
}

export const ingestProductSkill = defineOttoSkill({
  name: "ingestProduct",
  cost: "free",
  effect: "read",
  reach: "external",
  description:
    "Read a product's page from a URL (e.g. a Shopee/Lazada or store link) and get a draft of its " +
    "name, price, description, and image. $0, no approval. Use when the user gives you a product link " +
    "and wants it added to their products. It returns a DRAFT only — confirm the details with the user, " +
    "then save it with saveProduct. Never invent a price or facts not on the page.",
  parameters: ingestProductInput,
  execute: executeIngestProduct,
});

export const ingestProduct = ingestProductSkill.tool;
