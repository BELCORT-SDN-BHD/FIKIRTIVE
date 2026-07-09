# 金标准参考:Merdeka 策略级提案(GPT-5.6 Sol 试工卷,总审查员评 A/站得住)

> 用途:Wave C 内容工程(Campaign 提案引擎)的**产出金标准** —— Z4 施工与质检官对照用。它示范了判断层五条锻造标准的全部:证据锚定(Raya 312 盒/3:1 数据)、产能闸门(85 盒暂停)、可证伪假设(刻意低于 Raya 观测值)、stop/scale 门槛、代理指标标注。战略洞察一句话:"Raya 的教训不是制造稀缺,是配额与履约" —— 这就是"站得住"的样子。

## Task 2 — Roti Bulan Bakery Merdeka campaign proposal

### Ground truth and planning assumptions

Roti Bulan is a Kuala Lumpur bakery with a warm, neighbourly voice (`apps/web/components/northstar/_mock.ts:121-130`). The hero Merdeka offer already exists in customer-facing copy at **RM68 for 12 pieces**, with **RM8 Ampang delivery and free delivery above RM120** (`_mock.ts:376-382`). The product file also gives usable price anchors: pandan gula melaka cake RM88, kaya butter croissant RM8.50, Milo dinosaur cookie RM6, onde-onde cream puff RM7.50, Kopi-O tiramisu RM14, seasonal 12-piece gift box RM68, and matcha croffle RM12 (`_mock.ts:133-152`).

The strongest prior evidence is the Raya campaign: **312 boxes, RM21,216, sold out three days early**, with unboxing reels beating flat lays **3:1 on saves**, and Facebook producing corporate bulk orders (`_mock.ts:699-732`). The demo campaign has already set a goal of **100 Merdeka gift-box pre-orders** (`_mock.ts:903-910`). Trend snapshots say demand peaks Aug 24–31 and office-delivery POV clips work best under 15 seconds with an on-screen price (`_mock.ts:804-823`).

Planning window: **18–31 August 2026**, seven core posts across two weeks. Inventory, labour, ingredient and delivery capacity are not present in the data, so all release caps below are operational gates to confirm with the bakery lead before launch, not claims about actual capacity.

### Strategic objective

Secure **100 confirmed Merdeka box pre-orders by 30 August**, worth **RM6,800 in hero-product revenue before add-ons**, at a paid-media cost per confirmed box of **RM12 or less**. The second success condition is operational: no oversell, no missed fulfilment slot, and no paid acquisition continuing after capacity becomes uncertain.

The campaign idea is **“Open a little Malaysia”**: the sale is not a static box shot but the sensory sequence of opening, revealing, sharing and delivering a locally flavoured gift. This turns the proven 3:1 unboxing advantage into the campaign's organising creative device. Static assets support value and ordering details; they do not lead the campaign.

### Priority audiences and jobs-to-be-done

| Segment | Job-to-be-done | Barrier | Message/offer route |
|---|---|---|---|
| Warm Raya buyers and existing customers | “Help me secure a proven festive gift before it sells out again.” | Fear of missing the slot; no desire to research again | Early access to the RM68 box through opt-in WhatsApp; remind them that last festive run sold out early without manufactured urgency. |
| KL family hosts and gift-givers | “Give me a polished, shareable Merdeka gift below RM70 that looks thoughtful.” | Unclear value/contents; delivery friction | 12-piece ribboned box at RM68; show the lid reveal and every piece; RM8 Ampang delivery or free delivery above RM120. |
| Office admins, founders and team leads | “Let me arrange a festive office treat in one message, at a known cost and delivery time.” | Coordination risk and uncertainty about quantity | 10 gift boxes RM680, or the RM310 Office Tea Drop; click-to-WhatsApp enquiry with date, headcount and postcode prefilled. |
| Younger KL food-discovery audience | “Show me a local-flavour drop worth sharing with friends.” | Low trust in a brand ad; fast-scroll behaviour | Under-15-second packing/unboxing POV with the RM68 price on screen; creator-style process footage, not polished flat lays. |

### Offer architecture

1. **Hero: Merdeka gift box — RM68.** Twelve assorted pieces, ribbon included. This is the only hero SKU and the conversion denominator.
2. **Family pair — RM136.** Two boxes at the true unit price; it naturally crosses the existing RM120 free-delivery threshold. The value is convenience, not a margin-eroding discount.
3. **Corporate gift run — RM680 for 10 boxes.** No automatic discount until margin and packing labour are known. The CTA is a WhatsApp capacity check, not instant unlimited ordering.
4. **Office Tea Drop — RM310.** Twenty kaya butter croissants (20 × RM8.50 = RM170) plus ten Kopi-O tiramisu cups (10 × RM14 = RM140). Use this as a capacity-safe B2B alternative if gift-box inventory is tight.
5. **Add-ons at menu price.** Pandan gula melaka cake RM88, Kopi-O tiramisu RM14, kaya butter croissant RM8.50. Add-ons raise order value without discounting the scarce hero box.

No blanket early-bird discount is recommended. Raya proved demand exceeded supply; the commercial problem is allocation and fulfilment, not price resistance. Early access should buy a better choice of collection/delivery slot, not a cheaper box.

### Capacity and fulfilment guardrails

- Launch with **100 paid-order slots**, matching the campaign goal. Ring-fence 30 boxes for corporate enquiries through 25 August; release unused corporate allocation to D2C after that checkpoint.
- At **85 confirmed boxes**, pause broad acquisition for an inventory, ingredients, labour and delivery-slot reconciliation. Move all CTAs to a waitlist until the bakery lead signs off.
- Open a second batch of at most **20 additional boxes** only after the checkpoint. Marketing must not infer capacity from Raya's 312-box result; the Merdeka production window and product mix differ.
- Maintain a separate quality/replacement buffer determined by operations. Never include that buffer in visible “available” stock.
- Give every order a collection/delivery slot. When a slot fills, remove it rather than accepting an unbounded queue.
- Creative scarcity must report real state: “85 of 100 reserved” is acceptable; “almost gone” without a count is not.
- Stop paid media immediately if ingredients, packaging or delivery capacity slips. Existing paid customers outrank growth targets.

### Channel roles and paid budget

Recommended paid-media test budget: **RM1,200** for 14 days, excluding product and normal staff cost.

| Channel | Role | Split | RM | Operating rule |
|---|---|---:|---:|---|
| Instagram/Reels | Desire, proof, warm retargeting and conversion | 40% | 480 | Lead with lid reveal/packing; retarget 50% video viewers and site visitors. |
| TikTok | Cold discovery among food and gifting audiences | 25% | 300 | Native POV, under 15 seconds, price in first three seconds; do not overproduce. |
| Facebook | Family buyers plus corporate/office lead generation | 25% | 300 | Run the corporate post and value carousel; optimise corporate CTA for qualified WhatsApp conversations. |
| Reallocation reserve | Fund the demonstrated winner after 72 hours | 10% | 120 | Do not spend automatically. Move it only if inventory remains and a creative meets its decision threshold. |
| WhatsApp (owned) | Close warm demand, answer logistics, recover abandoned enquiries | 0% paid | 0 | Opt-in contacts only; one launch message and one capacity-based reminder, segmented by consumer/corporate intent. |

### Seven-post plan

These are seven core creative posts; each may be resized for the listed channels without becoming a new strategic idea.

| # / date | Segment and intent | Hook | Asset | Channel | CTA / offer | Primary KPI and decision threshold |
|---|---|---|---|---|---|---|
| **1 · Tue 18 Aug** | Warm buyers + food discovery. Announce the drop and establish sensory desire. | **“The Merdeka box starts with this sound.”** | 10–12s lid-opening reel: ribbon, lid, first reveal, hands passing the box; RM68/12 pieces on screen by second 2. | Instagram Reel + TikTok | “Reserve the RM68 box”; warm buyers go to a prefilled WhatsApp order. | 3-second view rate ≥35%; save rate at least 2× the later static value post. If not, recut the first two seconds before adding spend. |
| **2 · Thu 20 Aug** | Office admins. Generate high-value qualified conversations. | **“Your Merdeka office tea break, sorted in one message.”** | POV office delivery plus final table spread; overlay “RM310 · serves the team” and show 20 croissants + 10 tiramisu cups. | Facebook + Instagram | WhatsApp with date/headcount/postcode; choose RM310 Tea Drop or 10 boxes RM680. | 10 qualified corporate enquiries; ≥25% enquiry-to-confirmed-order; confirmed B2B AOV ≥RM310. |
| **3 · Sat 22 Aug** | Family hosts/gifters. Resolve value and contents questions. | **“12 pieces. One box. Everyone gets a favourite.”** | 5-frame carousel: closed box, full assortment, close-up texture, sharing moment, price/delivery card. | Instagram + Facebook | RM68 single; RM136 pair qualifies for free delivery above RM120. | Save rate ≥4%; product/WhatsApp click rate ≥1.5%; landing-to-enquiry conversion ≥4%. |
| **4 · Mon 24 Aug** | Cold discovery. Turn process into trust at the start of the peak week. | **“POV: 100 Merdeka boxes begin before sunrise.”** | Under-15s bakery POV: mixing, folding, packing, label, dispatch; price pinned on screen. | TikTok + Instagram Reel | “Choose your collection or delivery slot.” | 25% video completion; click rate ≥1.5%; cost per qualified WhatsApp start ≤RM6. |
| **5 · Wed 26 Aug** | Families buying for two households. Lift AOV without discounting. | **“One for your table. One for the house you're visiting.”** | Split-screen pair handoff; simple price card “2 × RM68 = RM136 · free delivery above RM120.” | Instagram + Facebook | Order the RM136 pair. | At least 25% of D2C boxes sold in pair orders; campaign AOV ≥RM85. If lower, clarify delivery value rather than cut price. |
| **6 · Sat 29 Aug** | Warm viewers and undecided buyers. Convert with proof and truthful availability. | **“This is what opening Roti Bulan looks like.”** | Customer-style unboxing montage plus real packing counter/remaining-slot card. | Instagram Reel + TikTok; retarget on Meta | Reserve remaining confirmed slots; waitlist if the 85-box pause gate is active. | Confirmed-box CPA ≤RM12; at least 15 confirmed boxes within 48h without crossing the capacity gate. |
| **7 · Mon 31 Aug** | Customers, followers and future buyers. Deliver the occasion and collect proof for the next campaign. | **“Selamat Hari Merdeka, from our ovens to your table.”** | Human, lightly edited fulfilment montage: pickups, office handoffs, team thank-you; no flat product hero. | Instagram + Facebook | If stock exists: final same-day slots. If not: waitlist/next-drop opt-in and request permission to reshare unboxings. | ≥95% orders fulfilled in the promised slot; 10 usable UGC permissions; waitlist captures demand without taking unsupported orders. |

### Measurement design and hypotheses

Use confirmed orders, not clicks, as the commercial truth. Every link should carry `campaign`, `post`, `channel`, `segment`, `creative_format` and `offer` UTMs; WhatsApp buttons should prefill distinct keywords such as `BOX68`, `PAIR136`, `OFFICE310` and `CORP680`. CRM/order records should store first source, last source, box quantity, order value and fulfilment slot.

Daily control view:

- confirmed boxes / 100 target, paid-order slots remaining, and slots remaining by fulfilment window;
- spend, confirmed-order CPA, hero revenue, total order value, AOV and gross media ROAS;
- 3-second views, completion, saves, outbound clicks, WhatsApp starts, qualified enquiries and confirmed orders by post;
- D2C vs corporate inventory take-up and pair-order share;
- cancellations, late fulfilments, replacements and refund requests.

Hypotheses to test:

1. **Process beats display.** Post 1/4/6 video save rate should be at least 2× Post 3's static/carousel rate. This is deliberately below Raya's observed 3:1 to avoid assuming perfect repeatability.
2. **Facebook earns its place through B2B value, not reach.** It can have a higher CPM if corporate enquiry-to-order is ≥25% and AOV is ≥RM310.
3. **Free-delivery qualification lifts basket size.** Pair framing should put at least 25% of D2C boxes into two-box orders and lift campaign AOV to RM85+ without a discount.
4. **Warm demand converts more efficiently.** Opted-in past buyers should convert at least 2× cold landing traffic. If the list has 200+ eligible contacts, keep a 10% no-message holdout to estimate incremental lift.
5. **Pacing protects more value than forced sell-out.** Pausing at 85 confirmed boxes should preserve service quality while still allowing a controlled final release; late fulfilment must remain below 5%.

Review creative after 24 hours for delivery errors and after 72 hours for budget decisions. Do not kill a post on early likes alone. Reallocate only when the downstream signal (qualified enquiry or confirmed order) agrees with the attention metric.

### Fallback plans

| Trigger | Response | What not to do |
|---|---|---|
| Orders reach 85 before 26 Aug | Pause acquisition, switch all CTAs to waitlist, reconcile stock/labour/slots, then release only signed-off capacity. Convert Posts 6–7 to transparent fulfilment/thank-you content. | Do not keep a “last chance” ad live or accept orders against the quality buffer. |
| Fewer than 35 confirmed boxes by 25 Aug | Release the RM120 reserve to the best qualified-enquiry creative; retarget video viewers with Post 3 value proof and Post 5 pair/free-delivery framing. | Do not introduce an uncosted discount when Raya already proved the product can sell. |
| Unboxing reel misses its video threshold after 72h | Recut with the lid reveal and RM68 price in the first two seconds; shorten to 8–10s; reuse the strongest customer-style shot. | Do not replace it immediately with another flat lay and lose the proven process advantage. |
| Corporate enquiries are weak by 25 Aug | Release unused corporate box allocation to D2C; keep the RM310 Tea Drop as the office fallback; move remaining Facebook spend to the best D2C Meta creative. | Do not promise bulk discounts or unlimited quantities. |
| Ingredient, packaging or delivery risk appears | Freeze new paid orders, pause ads, contact affected buyers first with a concrete revised slot or refund path, and publish a plain availability update. | Do not let marketing copy outrun operations or hide a delay behind generic festive content. |
| TikTok delivery is weak but Meta converts | Move only the unspent TikTok balance and the RM120 reserve after 72h; keep organic TikTok process content for learning. | Do not judge by views alone or move budget while capacity is paused. |

### Executive recommendation

Approve the campaign with the RM68 hero unchanged, a RM1,200 paid test, video-first creative, one serious corporate post, and a hard 85-order pause gate. The Raya lesson is not “manufacture more urgency.” It is “start earlier, show the unboxing, retain B2B, and pace demand so the bakery does not sacrifice three days of revenue or service quality again.”

