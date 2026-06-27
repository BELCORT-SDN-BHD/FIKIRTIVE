// Static Inspiration Gallery catalog (G5c). Pure — no DB, no React, no user data.
// Each prompt is a ready idea the user runs in Otto; "[your product]" is a fill-in hint.
export type Inspiration = {
  id: string;
  category: string;
  title: string;
  description: string;
  prompt: string;
};

export const INSPIRATIONS: Inspiration[] = [
  { id: "hero-white", category: "Product shots", title: "Clean hero shot", description: "Your product on a crisp white studio background.", prompt: "a professional product hero shot of [your product] on a clean white studio background, soft shadows, sharp focus, high detail" },
  { id: "hero-gradient", category: "Product shots", title: "Bold gradient backdrop", description: "Eye-catching colored gradient behind the product.", prompt: "product photo of [your product] centered on a smooth vibrant gradient backdrop, studio lighting, premium look" },
  { id: "raya", category: "Festival / Seasonal", title: "Hari Raya scene", description: "Festive Raya styling around your product.", prompt: "[your product] styled for Hari Raya — ketupat, warm lights, green and gold accents, festive and tasteful, product clearly visible" },
  { id: "cny", category: "Festival / Seasonal", title: "Chinese New Year scene", description: "Red-and-gold CNY mood.", prompt: "[your product] styled for Chinese New Year — red and gold decor, lanterns, prosperity mood, festive yet clean, product front and center" },
  { id: "deepavali", category: "Festival / Seasonal", title: "Deepavali scene", description: "Diya lights and rangoli warmth.", prompt: "[your product] styled for Deepavali — glowing diya lamps, colorful rangoli, warm festive lighting, product clearly visible" },
  { id: "ugc-hand", category: "Social / UGC", title: "In-hand UGC", description: "Authentic hand-held lifestyle look.", prompt: "casual UGC-style photo of a hand holding [your product], natural daylight, real and relatable, slightly imperfect for authenticity" },
  { id: "flatlay", category: "Social / UGC", title: "Flatlay", description: "Top-down styled flatlay with props.", prompt: "top-down flatlay of [your product] with complementary props on a textured surface, soft natural light, instagram-ready" },
  { id: "sale-banner", category: "Promotions / Sale", title: "Sale promo", description: "Bold discount-ready promo image.", prompt: "eye-catching promotional image for [your product] with empty space for a big sale headline, bold colors, high contrast, ad-ready" },
  { id: "lifestyle-scene", category: "Lifestyle", title: "Lifestyle in use", description: "Product in a real everyday setting.", prompt: "lifestyle photo of [your product] being used in a cozy real-world setting, warm natural light, aspirational but believable" },
];

/** Unique categories in first-seen order (for a filter row). */
export function inspirationCategories(list: Inspiration[]): string[] {
  const seen: string[] = [];
  for (const i of list) if (!seen.includes(i.category)) seen.push(i.category);
  return seen;
}
