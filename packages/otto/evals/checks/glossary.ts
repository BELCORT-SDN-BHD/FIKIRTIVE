/**
 * 镜头术语表的**唯一真相源解析器**。
 *
 * 词表本身住在 `packages/otto/knowledge/craft/seedance.md` 的「镜头术语表」一节
 * （`docs/specs/otto-engine.md` §7.0 拍板一定的路径）。`docs/specs/otto-engine.md` §7.3
 * 明写：Creation 批 III 的第四项机械检查（镜头词全部命中术语表）**从那份文件解析取词**，
 * 不在 `checks/` 里抄第二份 —— 所以这里只有解析，没有任何一个术语的字面量。
 *
 * 解析的形状（改词表时照着写就行）：
 *   `## …镜头术语表`
 *   `### <机器键> · <中文名>`
 *   `` - `术语` — 说明 ``
 * 遇到下一个同级 `##` 即本节结束。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
export const SEEDANCE_CRAFT_PATH = join(HERE, "..", "..", "knowledge", "craft", "seedance.md");

export type GlossaryKey = "camera-move" | "shot-framing" | "lighting";
export type Glossary = Record<string, string[]>;

/** 纯：markdown 全文 → { 机器键: 术语[] }。找不到那一节就抛（缺词表要当场炸，不能静默空表）。 */
export function parseGlossary(markdown: string): Glossary {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+.*镜头术语表/.test(l));
  if (start < 0) throw new Error("seedance.md 里找不到「镜头术语表」一节");

  const out: Glossary = {};
  let key: string | null = null;
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    const heading = /^###\s+([a-z][a-z0-9-]*)\s+·/.exec(line);
    if (heading) {
      key = heading[1]!;
      out[key] = [];
      continue;
    }
    const term = /^-\s+`([^`]+)`/.exec(line);
    if (term && key) out[key]!.push(term[1]!);
  }
  if (Object.keys(out).length === 0) throw new Error("「镜头术语表」一节里没有解析到任何小类");
  for (const [k, terms] of Object.entries(out)) {
    if (terms.length === 0) throw new Error(`镜头术语表小类 ${k} 是空的`);
  }
  return out;
}

let cached: Glossary | null = null;

/** 读磁盘上那份词表（进程内缓存一次）。 */
export function shotGlossary(): Glossary {
  cached ??= parseGlossary(readFileSync(SEEDANCE_CRAFT_PATH, "utf8"));
  return cached;
}
