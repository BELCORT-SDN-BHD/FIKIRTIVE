/**
 * verify-reference-video-mirror.test.ts — #663 P2-1(判官 r1 P2-1 收紧后)。
 *
 * `apps/web/scripts/verify-reference-video.mjs` 是一次**花真钱**的付费验证:它的全部价值,
 * 建立在「这个请求体和生产真路一字不差」这句话上。这句话一旦失真,我们就是在花钱验证一个
 * 我们根本不发的请求 —— 判官 r2 抓到的正是这个:脚本省略了 `ratio`,而真实付费路径会把
 * 缺省画幅归一为模型默认(16:9),一路带进适配器请求体。
 *
 * ## 这道闸怎么取值
 *
 * 不 grep 源码文本(那只证明文件里有那几个字),也不由测试侧喂值(那只是在断言自己写的
 * 常量)。做法是把脚本源码里的 `const MODEL` / `const content` / `const body` 三条声明
 * **各自的表达式整段截出来求值**,`duration` 的默认值也从脚本的 `arg("duration", "5")`
 * 里取。断言的每一个字段,值都来自脚本自己。
 *
 * 唯一由测试侧绑定的自由变量是 `videoUrl` 与 `prompt` —— 它们是命令行**输入**(运行时由
 * 人给),不是被断言的字段;绑成哨兵值只是为了让 `content` 能求值,断言只看它们出现在
 * 哪个位置、带什么 role。
 *
 * ## 覆盖边界(如实声明,别外推)
 *
 * 这道闸钉的是「脚本这一侧」,能对表的是付费真路里**归一化那一层**的产物:
 * `normalizeFactoryMaterial`(apps/web/lib/batch-idempotency.ts)—— 商家没选画幅/时长/
 * 清晰度/声音时落到的模型默认。这四项在这里逐项对表。
 *
 * 对不上表的是三项**适配器内部常量**:引擎模型 id、`watermark`、`execution_expires_after`。
 * 它们住在 `packages/generation`(apps/web 不依赖该包,拿不到),这里只能断言脚本自己的
 * 声明彼此自洽。那一侧由 `packages/generation/src/byteplus.test.ts` 的 #580 lockstep
 * 「整条请求体逐字段断言」钉住。**两道闸合起来才覆盖整条真路**,单看这一道不成立。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REFERENCE_VIDEO_MODEL } from "@fikirtive/core";
import { normalizeFactoryMaterial } from "../batch-idempotency";

const SCRIPT = path.resolve(__dirname, "../../scripts/verify-reference-video.mjs");
const SRC = readFileSync(SCRIPT, "utf8");

// 命令行输入的哨兵值(不是被断言的字段,见文件头「这道闸怎么取值」)。
const ARGV_VIDEO = "https://example.invalid/ref.mp4";
const ARGV_PROMPT = "  a sentinel prompt  ";

/** 截出 `const <name> = <表达式>;` 里那段表达式源码:按括号配平推进,跳过字符串与行注释,
 *  停在深度 0 的分号。三条声明(字符串 / 数组 / 对象)用的是同一套扫描。 */
function declExpr(name: string): string {
  const m = new RegExp(`(?:^|\\n)\\s*const\\s+${name}\\s*=\\s*`).exec(SRC);
  expect(m, `脚本里找不到 \`const ${name}\` —— 镜像闸失去了对象,先修这里`).toBeTruthy();
  const start = m!.index + m![0].length;
  let depth = 0;
  let quote: string | null = null;
  let i = start;
  for (; i < SRC.length; i++) {
    const c = SRC[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "/" && SRC[i + 1] === "/") { while (i < SRC.length && SRC[i] !== "\n") i++; continue; }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === ";" && depth === 0) break;
  }
  expect(i, `\`const ${name}\` 的表达式没有以分号收尾`).toBeLessThan(SRC.length);
  return SRC.slice(start, i);
}

function evalDecl<T>(name: string, scope: Record<string, unknown> = {}): T {
  const keys = Object.keys(scope);
  return new Function(...keys, `return (${declExpr(name)});`)(...keys.map((k) => scope[k])) as T;
}

describe("#663 P2-1 付费验证脚本 ↔ 真实付费路径(镜像)", () => {
  it("脚本自己求值出来的 body,四项归一化控制项与付费真路逐项对表(画幅按模型默认归一,不是省略)", () => {
    // ── 全部取自脚本源码 ──────────────────────────────────────────────
    const MODEL = evalDecl<string>("MODEL");
    const content = evalDecl<Array<Record<string, unknown>>>("content", { videoUrl: ARGV_VIDEO, prompt: ARGV_PROMPT });
    const durationArg = /arg\("duration",\s*"([^"]+)"\)/.exec(SRC);
    expect(durationArg, "脚本里找不到 duration 的默认值").toBeTruthy();
    const duration = durationArg![1]!;
    const body = evalDecl<Record<string, unknown>>("body", { MODEL, content, duration });

    // ── 付费真路的归一化产物:商家什么都没选时落到的模型默认 ─────────────
    const material = normalizeFactoryMaterial({
      prompt: ARGV_PROMPT.trim(), model: REFERENCE_VIDEO_MODEL, kind: "video", count: 1,
      referenceVideoGenerationId: "gen_ref",
      // 画幅 / 时长 / 清晰度 / 声音一概不给 —— 这正是参考视频那条路的样子。
    });
    const paid = material.videoOptions!;
    expect(paid.aspectRatio).toBe("16:9"); // 现役参考视频模型的默认画幅(漂移了下面立刻红)

    // ── 逐项对表:这四项脚本必须发得和真路一样 ──────────────────────────
    expect(body.ratio).toBe(paid.aspectRatio);        // #663 P2-1 的本体:缺省画幅被归一,不是省略
    expect(body.duration).toBe(paid.seconds);         // 脚本固定 5s 的计价模型 = 模型默认时长
    expect(body.resolution).toBe(paid.resolution);
    expect(body.generate_audio).toBe(paid.audio);
    // 脚本对时长是硬拒的(≠5 直接退出),所以上面那条不是巧合而是它的契约。
    expect(SRC).toMatch(/Number\(duration\) !== 5/);

    // ── 脚本自洽:body 用的是它自己声明的常量,不是另抄一份字面量 ─────────
    expect(body.model).toBe(MODEL);
    expect(body.content).toBe(content);
    const parts = content as Array<{ type: string; role?: string; video_url?: { url: string }; text?: string }>;
    expect(parts.map((p) => p.type)).toEqual(["video_url", "text"]);
    expect(parts[0]!.role).toBe("reference_video");
    expect(parts[0]!.video_url!.url).toBe(ARGV_VIDEO);
    expect(parts[1]!.text).toBe(ARGV_PROMPT.trim()); // 文本部分只带商家的话(#646 T5)

    // ── 覆盖边界外的三项适配器常量:这里只钉脚本这一侧,真身在 byteplus.test.ts ──
    expect(body.watermark).toBe(false);
    expect(body.execution_expires_after).toBe(3600);
    expect(MODEL).toBe("dreamina-seedance-2-0-fast-260128");

    // 字段集合本身也钉住:脚本多发一个字段(真路不发)同样是镜像失真。
    expect(Object.keys(body).sort()).toEqual(
      ["content", "duration", "execution_expires_after", "generate_audio", "model", "ratio", "resolution", "watermark"],
    );
  });
});
