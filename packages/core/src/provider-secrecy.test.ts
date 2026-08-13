/**
 * #791-6:白标铁律机器化。
 *
 * 「不告诉商家用的是谁家的引擎」以前只是一条写在提示词里的话,加上一条只管
 * job.error 的过滤器。Otto 自己天天跟商家说话、而且知道那些名字(它的提示词技能就叫
 * seedreamPrompt / seedancePrompt)—— 中间什么都没有。这里是那个「什么」。
 */
import { describe, it, expect } from "vitest";
import { redactProviderNames, createProviderNameFilter } from "./provider-secrecy.js";

const SECRETS = [
  "Seedance 2.0 made this clip",
  "generated with seedream 4.5",
  "byteplus returned an error",
  "we call the fal.ai endpoint",
  "即梦 rendered it",
  "I'm running on the claude model",
  "captions come from whisper.cpp", // #787 字幕引擎
  "whisper-cli returned nothing",
  "the model file is ggml-small.bin",
];

describe("redactProviderNames", () => {
  it("每一种写法都换成 generation provider", () => {
    for (const s of SECRETS) {
      const out = redactProviderNames(s);
      expect(out).toContain("generation provider");
      expect(out.toLowerCase()).not.toMatch(
        /seedance|seedream|byteplus|bytedance|jimeng|即梦|whisper\.cpp|whisper-cli|ggml/,
      );
    }
  });

  it("不动无关文字", () => {
    expect(redactProviderNames("Your video is ready — 5 seconds, 9:16.")).toBe(
      "Your video is ready — 5 seconds, 9:16.",
    );
  });

  // #787:字幕引擎那两条是**故意收窄**的。whisper 是一个普通英文词,商家真的可能在卖
  // 「whisper-quiet fan」;洗掉商家自己的商品名比说出引擎名更糟(#810 已经栽过一次)。
  it("商家自己的 whisper 不许被洗掉", () => {
    for (const innocent of [
      "Our whisper-quiet fan is back in stock",
      "a whisper of vanilla in every cup",
      "Whisper Lane, Penang",
    ]) {
      expect(redactProviderNames(innocent)).toBe(innocent);
    }
  });

  // #779 判官 r1 P2-1:同一家供应商的**可观测面**名字以前一个都不在表里 —— 上游错误串
  // 「Volcengine quota exceeded」原样上了页面。补齐的是名字,不是防线:真正的防线在
  // apps/web/lib/queue-observability.ts,那里上游文字一个字都不渲染。
  it("供应商的可观测面名字也换成 generation provider", () => {
    for (const s of [
      "Volcengine quota exceeded",
      "VMP query refused",
      "volc endpoint timeout",
      "prometheus remote write failed",
      "ark-api-key rejected",
      "arkapi returned 401",
    ]) {
      const out = redactProviderNames(s);
      expect(out).toContain("generation provider");
      expect(out.toLowerCase()).not.toMatch(/volcengine|\bvmp\b|\bvolc\b|prometheus|ark[-._/:]|arkapi/);
    }
  });

  // ark 是普通英文词(方舟),按 whisper 同一条规矩收窄:只认技术形状,裸词不动。
  it("商家自己的 ark 不许被洗掉", () => {
    for (const innocent of [
      "Noah's ark is our bestseller",
      "Ark Encounter tickets, RM120",
      "the ark of the covenant",
    ]) {
      expect(redactProviderNames(innocent)).toBe(innocent);
    }
  });

  // 上面几个新 token 是**裸词**匹配,所以它们的近音词就是新增的误伤面。洗掉商家自己的
  // 商品名比说出引擎名更糟(#810 栽过一次),所以这些形状逐个钉住:`volc` 后面必须断词,
  // `vmp`、`ark` 同理。
  it("新增 token 的近音词不许被误伤", () => {
    for (const innocent of [
      "Volcano Hot Pot, Penang",
      "volcanic ash face mask",
      "our VMPro blender",
      "Arkitek Studio, Johor",
      "markup is 30%",
    ]) {
      expect(redactProviderNames(innocent)).toBe(innocent);
    }
  });
});

describe("createProviderNameFilter — 流式也拦得住", () => {
  /** 把一段文字切成任意大小的块喂进去,拼回来的结果必须和整段洗一次一模一样。 */
  function streamThrough(text: string, chunkSize: number): string {
    const filter = createProviderNameFilter();
    let out = "";
    for (let i = 0; i < text.length; i += chunkSize) {
      out += filter.push(text.slice(i, i + chunkSize));
    }
    return out + filter.flush();
  }

  it("名字被切成两半跨块到达,依然拦得住", () => {
    const text = "This was made with Seedance 2.0 for you.";
    for (const chunkSize of [1, 2, 3, 5, 7, 11, 40]) {
      const out = streamThrough(text, chunkSize);
      expect(out.toLowerCase(), `chunk=${chunkSize}`).not.toContain("seedance");
      expect(out, `chunk=${chunkSize}`).toBe(redactProviderNames(text));
    }
  });

  it("逐字符流式与整段洗名逐字节一致(几段真实回复)", () => {
    const replies = [
      "Done! Your image is ready — want a tighter crop?",
      "I used seedream 4.5 with a 9:16 crop, and the video came from Seedance 2.0.",
      "The generation failed on byteplus, so you were not charged.",
      "claude model here — anything else?",
    ];
    for (const reply of replies) {
      for (const chunkSize of [1, 4, 13]) {
        expect(streamThrough(reply, chunkSize), `${reply} @${chunkSize}`).toBe(
          redactProviderNames(reply),
        );
      }
    }
  });

  it("没有秘密的时候什么也不改", () => {
    const text = "Two options: a warm daylight shot, or a night-market look. Which one?";
    expect(streamThrough(text, 6)).toBe(text);
  });
});

/**
 * #810 跨族判官首轮:上面那三条测试全绿,但它们只喂了「块大小固定、名字离得近」的文本。
 * 判官用两个形状把「流式 = 整段」这个承诺打穿了 —— 一个泄密,一个误伤:
 *
 *  P1-3 尾缓冲 64 字符 < 正则真实能跨的距离(正则里有无上限量词),名字先发出去再也追不回来;
 *  P2-1 尾缓冲从任意位置切,切点凭空长出一个词边界,把合法复合词误洗成 generation provider。
 *
 * 两条同一个根:**流式和整段是两套判断**。修法是让正则有可证明的真实上限,并且让流式端
 * 永远拿着真实的左邻字符去判断词边界 —— 于是下面这条不变式对任意切法都成立。
 */
describe("#810 流式与整段逐字节一致 —— 判官的两个复现形状", () => {
  function streamThrough(text: string, chunkSize: number): string {
    const filter = createProviderNameFilter();
    let out = "";
    for (let i = 0; i < text.length; i += chunkSize) out += filter.push(text.slice(i, i + chunkSize));
    return out + filter.flush();
  }
  /** 判官复现用的、按任意切点分块的喂法(不是等长块)。 */
  function streamThroughCuts(text: string, cuts: number[]): string {
    const filter = createProviderNameFilter();
    let out = "";
    let at = 0;
    for (const cut of [...cuts, text.length]) {
      if (cut <= at) continue;
      out += filter.push(text.slice(at, Math.min(cut, text.length)));
      at = Math.min(cut, text.length);
    }
    if (at < text.length) out += filter.push(text.slice(at));
    return out + filter.flush();
  }

  it("P1-3:长词把名字推出 64 字符尾缓冲之外时,流式不得先把名字发出去", () => {
    // 判官原样:chunk1 = "claude " + 80 个 x,chunk2 = " api"。
    const chunk1 = "claude " + "x".repeat(80);
    const chunk2 = " api";
    const whole = chunk1 + chunk2;
    const filter = createProviderNameFilter();
    const streamed = filter.push(chunk1) + filter.push(chunk2) + filter.flush();
    // 唯一的硬要求:两侧说同一句话。名字要么两边都洗、要么两边都留,不许流式先泄。
    expect(streamed).toBe(redactProviderNames(whole));
    // 而且不管两侧最终怎么判,「先发一半」这件事本身必须消失:
    // 流式发出的第一段里不能有整段过滤会洗掉的名字。
    if (!redactProviderNames(whole).toLowerCase().includes("claude")) {
      expect(streamed.toLowerCase()).not.toContain("claude");
    }
  });

  it("P2-1:切块不得凭空制造词边界(合法复合词不该被误洗)", () => {
    // 判官原样:"AAmyseedance " + 55 个 x —— 整段过滤原样保留(seedance 前面是字母 y,无 \b)。
    const text = "AAmyseedance " + "x".repeat(55);
    expect(redactProviderNames(text)).toBe(text); // 整段:一个字都不动
    for (const chunkSize of [1, 3, 7, 13, 64, 68]) {
      expect(streamThrough(text, chunkSize), `chunk=${chunkSize}`).toBe(text);
    }
    expect(streamThroughCuts(text, [4]), "切在 AAmy 之后").toBe(text);
  });

  it("对任意切法都成立:一段含秘密名、超长词、合法复合词的语料,流式 = 整段", () => {
    const corpus = [
      "Done — your image is ready. I used seedream 4.5 and the clip came from Seedance 2.0 fast.",
      "AAmyseedance is my shop name, and myseedreamstore is my other one — neither is a model.",
      "claude " + "x".repeat(80) + " api",
      "claude sonnet api / anthropic model / model claude / provider anthropic",
      "byteplus.example.com/v1 returned an error; fal.ai timed out; 即梦 rendered it.",
      "generation provider seedance seedream byteplus back to back",
      "The generation provider handled it — no seedance here, but seedance.pro/v2 3.1 fast is.",
      "no secrets at all: two options, a warm daylight shot or a night-market look?",
    ].join("\n");
    const whole = redactProviderNames(corpus);
    // ① 每一种等长块
    for (let chunkSize = 1; chunkSize <= 40; chunkSize++) {
      expect(streamThrough(corpus, chunkSize), `chunk=${chunkSize}`).toBe(whole);
    }
    // ② 伪随机不等长切法(固定种子 → 失败可复现)
    let seed = 20260809;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let trial = 0; trial < 200; trial++) {
      const cuts: number[] = [];
      for (let at = 0; at < corpus.length; ) {
        at += 1 + Math.floor(rand() * 90);
        cuts.push(at);
      }
      expect(streamThroughCuts(corpus, cuts), `trial=${trial} cuts=${cuts.slice(0, 8).join(",")}`).toBe(whole);
    }
  });

  it("P2(r2):替身字符的词类判断必须与主正则同口径(`iu`)", () => {
    // 主正则带 `iu`,所以 `\b` 眼里的「词字符」包含 K(U+212A 开尔文号)与 ſ(U+017F 长 s)——
    // 它们在 `i`+`u` 的大小写折叠下等价于 k / s。于是整段过滤看到 "Kseedance" 是**没有词边界**
    // 的,一个字不动。判断替身字符时若用不带 flag 的 /\w/,K 会被当成非词字符、换成空格,
    // 切点凭空造出边界 —— 又回到 P2-1 那类误洗,只是换了个字符。
    for (const lead of ["K", "\u017F"]) {
      const text = `${lead}seedance ` + "x".repeat(80);
      expect(redactProviderNames(text), `整段:${lead}`).toBe(text);
      // 恰好切在那个字符之后 —— 最能暴露替身判断的位置。
      expect(streamThroughCuts(text, [1]), `流式切在 ${lead} 之后`).toBe(text);
      for (const chunkSize of [1, 2, 5, 13, 64]) {
        expect(streamThrough(text, chunkSize), `${lead} @chunk=${chunkSize}`).toBe(text);
      }
    }
  });

  it("生成式穷举:随机拼出来的文本 × 随机切法,一律流式 = 整段", () => {
    // 一段固定语料只能证明它自己。这里把名字、版本号、后缀、空白、合法复合词、以及一段
    // 已经是 generation provider 的字面量随机拼起来 —— 专挑边界:名字紧挨名字(重复折叠)、
    // 名字被字母黏住(假词边界)、名字与 api 之间隔着超长词(尾缓冲跨度)。
    const pieces = [
      "seedance", "seedream", "byteplus", "bytedance", "jimeng", "fal", "claude", "anthropic", "即梦",
      "generation provider", "api", "sdk", "model", "provider", "error", "version",
      "2.0", "4.5", "fast", ".pro/v2", "-3", "sonnet", "claude-3", "anthropicapi", "seedanceprovider",
      " ", "  ", "\n", "\t", "x", "AAmy", "store", "the", "false", "myseedreamstore",
      // 大小写折叠下等价于 k / s 的两个字符 —— 词边界判断最容易两套口径的地方。
      "K", "\u017F", "K\u017F", "SEEDANCE", "SeeDream", "BytePlus",
      "x".repeat(30), "10.2.3.4", ",", ";", "!", "?", "-", "/", ".", ":", "_",
    ];
    let seed = 810;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let trial = 0; trial < 1500; trial++) {
      let text = "";
      const parts = 1 + Math.floor(rand() * 14);
      for (let i = 0; i < parts; i++) text += pieces[Math.floor(rand() * pieces.length)];
      const cuts: number[] = [];
      for (let at = 0; at < text.length; ) {
        at += 1 + Math.floor(rand() * 8);
        cuts.push(at);
      }
      expect(streamThroughCuts(text, cuts), `trial=${trial} src=${JSON.stringify(text)}`).toBe(
        redactProviderNames(text),
      );
    }
  });
});
