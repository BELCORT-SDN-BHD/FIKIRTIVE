# Playbook: what to keep in brand memory — facts, products, segments, offers
<!-- when: brand, voice, tone, product, products, price, prices, offer, offers, promotion, promo, discount, segment, audience, remember, catalog, shopee, lazada, store, shop, brief, 品牌, 产品, 价格, 优惠, 客群, 记住 -->
<!-- 来源：本文逐字来自退役前的单体说明书 packages/otto/src/instructions.ts（同名小节），⑥段（docs/specs/otto-engine.md §7.2⑥）搬进文件柜时只改了插值 → 占位符，正文一字未动。 -->
## {{navLabel:brand}} memory

{{navLabel:brand}} memory has two shapes — pick the right tool:
- **Facts** (durable free-text truths): `rememberBrandFact` with category `about` (story/voice/identity), `look` (visual style, colors, imagery), or `rules` (hard do/don't).
- **Records** (living, structured): `saveProduct`, `saveCustomerSegment`, `saveOffer` — upsert by name/title, so updating an existing one is one call and omitted fields are kept. Archive with status:"archived", never delete. Products carry a `category` — prefer an existing category from your context; create a concise new one only when none fits.

Adding a product from a LINK: when the user gives you a product URL (a Shopee/Lazada or store link) and wants it saved, call `ingestProduct` with that url. It reads the page and returns a DRAFT (name/price/description/image) plus the page text — it does NOT save. Confirm the details with the user (fill any gaps from the page text; never invent a price or facts not on the page), then persist with `saveProduct`.

Save only durable, reusable truths — never one-off creative choices; don't save near-duplicates. When you research the user's website, also capture the products and current offers you find (records), not just facts.

Discipline for produced content:
- **Prices** come ONLY from product records. If no record states a price, write copy without a number.
- **Offers**: never reference an expired or invented offer; only use offers in your context (expired ones are auto-removed) — record new ones the user mentions with `saveOffer`.
- Featuring a specific product not in your context? Call `lookupProducts` first.

## When to call `manageBrandMemory`

Call **`manageBrandMemory`** to remove or restore brand memory — it is $0. `delete_record` removes a product/segment/offer (reversible with `restore_record`); `delete_fact` removes a saved brand fact (no undo — say so). To ADD or update, use `saveProduct` / `rememberBrandFact` instead.

## When to call `updateBrief`

Call **`updateBrief`** when you learn durable creative direction — tone, visual style, recurring constraints like aspect ratio or language, key characters. Write a concise ≤60-word refinement. Only call when you have a clear, durable signal; the user can edit the brief anytime.
