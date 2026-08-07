// 375px 移动端布局回归检查(#685 / #722 / #697 / #730)。
//
// 四条断言,全部在真实浏览器里量,不看 class 字符串:
//   1. 无横向溢出   document.documentElement.scrollWidth <= clientWidth
//   2. 顶部不被遮挡  页面第一个标题 / 返回链接的矩形与浮动导航按钮不相交,
//                    且该位置的 elementFromPoint 命中的是内容本身(能点得到)
//   3. 主行动在屏内  指定的主按钮 boundingBox 完整落在视口内
//   4. 窄屏按钮让行  一行 flex 里的按钮必须换到正文下面,不把正文挤成细长条
//
// 用法(本地 dev,先起 worker 再起 web):
//   node scripts/tools/mobile-viewport-check.mjs --base http://localhost:3111 --state ./state.json
// state.json 由 Playwright storageState 产生(登录一次即可复用)。
// 需要有数据的面:Inbox / Broadcasts 空态不复现 #730,先建一条会话与一条广播。
import { chromium } from "playwright";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const BASE = arg("base", "http://localhost:3111");
const STATE = arg("state", null);
const VIEWPORT = { width: 375, height: 812 };

/** 每个面:path = 路由;topAnchor = 顶部第一个必须完整可见的内容(标题或返回链接);
 *  primaryAction = 必须整块落在视口内的主按钮(可选)。 */
const SURFACES = [
  { ticket: "#685", path: "/billing", topAnchor: "h1" },
  { ticket: "#685", path: "/profile", topAnchor: "h1" },
  { ticket: "#685", path: "/campaign", topAnchor: "a:has-text('Return to Otto')" },
  { ticket: "#685", path: "/campaign/calendar", topAnchor: "a:has-text('Return to Otto')" },
  { ticket: "#685", path: "/campaign/trends", topAnchor: "a:has-text('Return to Otto')" },
  { ticket: "#685", path: "/campaign/workbench", topAnchor: "a:has-text('Return to Otto')" },
  { ticket: "#685/#730", path: "/crm/inbox", topAnchor: "a:has-text('Return to Otto')" },
  { ticket: "#685/#730", path: "/crm/broadcasts", topAnchor: "a:has-text('Return to Otto')" },
  { ticket: "#685", path: "/crm/templates", topAnchor: "a:has-text('Return to Otto')" },
  {
    ticket: "#722",
    path: "/crm/workflows",
    topAnchor: "a:has-text('Return to Otto')",
    primaryAction: "button:has-text('New workflow')",
  },
  { ticket: "#722", path: "/crm/workflows/wf_seed_0", topAnchor: "a:has-text('Back to Workflows'), a:has-text('Return to Otto')" },
  {
    ticket: "#697",
    path: "/otto?view=analytics",
    skipTopAnchor: true,
    stacked: { text: "text=/Your best day was/", button: "button:has-text('Make more like it')" },
  },
  {
    ticket: "#697",
    path: "/otto?view=schedule",
    skipTopAnchor: true,
    // textParent: measure the copy COLUMN, not just its one-line heading.
    stacked: { text: "text=No plan from Otto yet", textParent: 1, button: "button:has-text('New post')" },
  },
];

const NAV_TRIGGER = "button[aria-label='Open navigation']";

function overlaps(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: VIEWPORT, ...(STATE ? { storageState: STATE } : {}) });
const page = await ctx.newPage();

const failures = [];
const rows = [];

for (const surface of SURFACES) {
  const url = `${BASE}${surface.path}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 180000 });
  // networkidle never settles on this app (streaming + HMR): wait for hydration markers instead.
  await page.waitForSelector("main, [data-slot='card'], h1", { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(2500);

  const landed = new URL(page.url()).pathname;
  if (landed.startsWith("/login")) {
    failures.push(`${surface.path}: not authenticated (landed on ${landed})`);
    continue;
  }

  const overflow = await page.evaluate(() => {
    const el = document.documentElement;
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });
  const overflowPx = overflow.scrollWidth - overflow.clientWidth;

  let anchorVerdict = "skipped";
  if (!surface.skipTopAnchor) {
    const trigger = await page.locator(NAV_TRIGGER).first().boundingBox().catch(() => null);
    const anchor = await page.locator(surface.topAnchor).first().boundingBox().catch(() => null);
    if (!trigger) anchorVerdict = "no nav trigger (desktop tier?)";
    else if (!anchor) anchorVerdict = `anchor "${surface.topAnchor}" not found`;
    else if (overlaps(trigger, anchor)) {
      anchorVerdict = `OVERLAP trigger(${Math.round(trigger.x)},${Math.round(trigger.y)},${Math.round(trigger.width)}x${Math.round(trigger.height)}) vs anchor(${Math.round(anchor.x)},${Math.round(anchor.y)},${Math.round(anchor.width)}x${Math.round(anchor.height)})`;
      failures.push(`${surface.ticket} ${surface.path}: nav trigger covers ${surface.topAnchor} — ${anchorVerdict}`);
    } else {
      // The anchor must also be the element the merchant actually hits at its own top-left.
      const hit = await page.evaluate(
        ([x, y]) => {
          const el = document.elementFromPoint(x, y);
          return el ? `${el.tagName}${el.getAttribute("aria-label") ? `[${el.getAttribute("aria-label")}]` : ""}` : "none";
        },
        [Math.round(anchor.x + 3), Math.round(anchor.y + anchor.height / 2)],
      );
      anchorVerdict = `clear (top-left hit: ${hit})`;
      if (hit.includes("Open navigation")) {
        failures.push(`${surface.ticket} ${surface.path}: nav trigger intercepts clicks on ${surface.topAnchor}`);
      }
    }
  }

  let actionVerdict = "n/a";
  if (surface.primaryAction) {
    const box = await page.locator(surface.primaryAction).first().boundingBox().catch(() => null);
    if (!box) actionVerdict = `"${surface.primaryAction}" not found`;
    else {
      const inside = box.x >= 0 && box.x + box.width <= VIEWPORT.width;
      actionVerdict = inside
        ? `in viewport (right=${Math.round(box.x + box.width)})`
        : `OUT OF VIEWPORT (right=${Math.round(box.x + box.width)} > ${VIEWPORT.width})`;
      if (!inside) failures.push(`${surface.ticket} ${surface.path}: ${surface.primaryAction} is off screen — ${actionVerdict}`);
    }
  }

  let stackedVerdict = "n/a";
  if (surface.stacked) {
    let textLocator = page.locator(surface.stacked.text).first();
    for (let i = 0; i < (surface.stacked.textParent ?? 0); i += 1) textLocator = textLocator.locator("xpath=..");
    const textBox = await textLocator.boundingBox().catch(() => null);
    const buttonBox = await page.locator(surface.stacked.button).first().boundingBox().catch(() => null);
    if (!textBox || !buttonBox) stackedVerdict = "text or button not found";
    else if (buttonBox.y + 2 < textBox.y + textBox.height) {
      stackedVerdict = `SAME ROW (text ${Math.round(textBox.width)}px wide, button top=${Math.round(buttonBox.y)} vs text bottom=${Math.round(textBox.y + textBox.height)})`;
      failures.push(`${surface.ticket} ${surface.path}: ${surface.stacked.button} does not wrap below the copy — ${stackedVerdict}`);
    } else {
      stackedVerdict = `wrapped (text ${Math.round(textBox.width)}px wide)`;
    }
  }

  if (overflowPx > 0) {
    failures.push(`${surface.ticket} ${surface.path}: horizontal overflow ${overflowPx}px (scrollWidth ${overflow.scrollWidth} > clientWidth ${overflow.clientWidth})`);
  }

  rows.push({
    ticket: surface.ticket,
    path: surface.path,
    overflowPx,
    topAnchor: anchorVerdict,
    primaryAction: actionVerdict,
    stacked: stackedVerdict,
  });
}

await browser.close();

console.table(rows);
if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s) at ${VIEWPORT.width}px:`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`\n✓ all ${rows.length} surfaces clean at ${VIEWPORT.width}px`);
