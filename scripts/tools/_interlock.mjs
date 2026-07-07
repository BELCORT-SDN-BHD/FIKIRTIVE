// 统一确认锁(MASTERPLAN 7-12 / 批次 3c)。花钱脚本要求 I_UNDERSTAND_THIS_SPENDS=yes,
// 碰 prod 的脚本要求 I_UNDERSTAND_THIS_TOUCHES_PROD=yes;两者都占的要同时给两个。
// 缺任何一个:打印该脚本会花什么/碰什么,exit 1。用法(脚本最顶部,任何副作用之前):
//   import { interlock } from "../tools/_interlock.mjs";   // archive/ 下
//   import { interlock } from "./_interlock.mjs";          // tools/ 下
//   interlock({ spends: "~$1.1 real fal generations", prod: "prod Neon DB + prod worker queue" });
export function interlock({ spends, prod } = {}) {
  const missing = [];
  if (spends && process.env.I_UNDERSTAND_THIS_SPENDS !== "yes")
    missing.push(["I_UNDERSTAND_THIS_SPENDS", `SPENDS REAL MONEY: ${spends}`]);
  if (prod && process.env.I_UNDERSTAND_THIS_TOUCHES_PROD !== "yes")
    missing.push(["I_UNDERSTAND_THIS_TOUCHES_PROD", `TOUCHES PROD: ${prod}`]);
  if (missing.length === 0) return;
  for (const [, what] of missing) console.error(`REFUSING: this script ${what}`);
  console.error(`To proceed, set: ${missing.map(([k]) => `${k}=yes`).join(" ")}`);
  process.exit(1);
}
