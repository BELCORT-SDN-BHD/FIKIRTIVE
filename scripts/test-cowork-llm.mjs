// Verify real cowork produces a valid storyboard plan (fal → claude-sonnet-4.5).
// Run via: railway run --service web -- node scripts/test-cowork-llm.mjs
const key = process.env.FAL_KEY;
if (!key) { console.error("FAL_KEY not set"); process.exit(1); }
const { coworkPlan, COWORK_MAX_SCENES, COWORK_MAX_SHOTS_PER_SCENE } = await import("../packages/core/dist/index.js");

const system =
  `You are a film director's assistant. Break the user's idea into a concise storyboard. ` +
  `Respond with ONLY a JSON object, no prose: {"scenes":[{"title":"string","shots":[{"prompt":"string"}]}]}. ` +
  `Each shot "prompt" is a vivid, self-contained visual description (subject, framing, camera, lighting, mood) for an image generator — not dialogue. ` +
  `At most ${COWORK_MAX_SCENES} scenes and ${COWORK_MAX_SHOTS_PER_SCENE} shots per scene.`;
const res = await fetch("https://fal.run/openrouter/router/openai/v1/chat/completions", {
  method: "POST",
  headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "anthropic/claude-sonnet-4.5",
    messages: [{ role: "system", content: system }, { role: "user", content: "a moody coffee ad: a barista crafts a latte at dawn in a quiet cafe" }],
  }),
});
console.log("HTTP", res.status);
if (!res.ok) { console.error((await res.text()).slice(0, 400)); process.exit(1); }
const raw = (await res.json()).choices?.[0]?.message?.content ?? "";
const plan = coworkPlan.parse(JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)));
console.log(`✓ valid plan: ${plan.scenes.length} scene(s), ${plan.scenes.reduce((n, s) => n + s.shots.length, 0)} shots`);
plan.scenes.forEach((s, i) => {
  console.log(`  Scene ${i + 1}: ${s.title}`);
  s.shots.forEach((sh, j) => console.log(`    ${j + 1}. ${sh.prompt.slice(0, 80)}`));
});
console.log("\nCOWORK REAL-LLM OK (fal → claude-sonnet-4.5)");
process.exit(0);
