// Static built-in template catalog (G5b). Pure — no DB, no React, no server.
// Each template is an image-to-image preset run through the existing startGen spend gate.
import { GEN_PRICE_USD_PER_IMAGE } from "@fikirtive/core";

export type TemplateQuestion = { label: string; placeholder: string };
export type Template = {
  id: string;
  name: string;
  description: string;
  needsImage: boolean;
  question?: TemplateQuestion;
  promptTemplate: string; // contains "{q}" iff `question` is present
};

export const TEMPLATES: Template[] = [
  {
    id: "remove-bg",
    name: "Remove background",
    description: "Drop in a product photo, get it on a clean white studio backdrop.",
    needsImage: true,
    promptTemplate:
      "remove the background and place the product on a clean white studio backdrop, keep the product edges sharp, photorealistic",
  },
  {
    id: "remove-object",
    name: "Remove object",
    description: "Upload an image and tell me what to take out.",
    needsImage: true,
    question: { label: "What should I remove?", placeholder: "e.g. the person in the back" },
    promptTemplate: "remove the {q} from the image and fill the area naturally, photorealistic",
  },
  {
    id: "product-in-scene",
    name: "Product in a scene",
    description: "Place your product into any setting you describe.",
    needsImage: true,
    question: {
      label: "Describe the scene / background",
      placeholder: "e.g. on a marble kitchen counter, soft morning light",
    },
    promptTemplate:
      "place this product in {q}, professional product photography, realistic lighting and shadows",
  },
  {
    id: "festival-makeover",
    name: "Festival makeover",
    description: "Give your product a festive look — Raya, CNY, Deepavali and more.",
    needsImage: true,
    question: { label: "Which festival?", placeholder: "e.g. Hari Raya, CNY, Deepavali" },
    promptTemplate:
      "restyle this image with a festive {q} theme — tasteful decorations and lighting, keep the product clear and centered",
  },
];

/** Fill "{q}" with the trimmed answer; no-question templates return their prompt verbatim. */
export function buildTemplatePrompt(t: Template, answer?: string): string {
  if (!t.question) return t.promptTemplate;
  return t.promptTemplate.replace("{q}", (answer ?? "").trim());
}

const USD_PER_DISPLAY_CREDIT = 0.1; // mirrors @fikirtive/core spend.ts display denomination
/** Displayed-credit cost of one template run (1 image): max(1, ceil($0.04 / $0.10)) = 1. */
export function templateRunCredits(): number {
  return Math.max(1, Math.ceil(GEN_PRICE_USD_PER_IMAGE / USD_PER_DISPLAY_CREDIT));
}
