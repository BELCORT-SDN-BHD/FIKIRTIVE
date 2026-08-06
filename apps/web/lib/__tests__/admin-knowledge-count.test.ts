/**
 * #647 T6 修复轮 P1-2 —— 知识格的「已填 / 总数」必须**同源**。
 *
 * 判官 r1 现场:T6 把总数收成五个真格,已填却仍旧数**数据库里的全部历史行**
 * (admin-v2.ts)。旧种子 13 条不删(删行是数据变更,不做)、界面又只渲染真格、写入闸还
 * 拒绝假格 —— 于是一个完全合法的历史状态会在后台显示 **13/5**,而且商家/Founder 在界面上
 * 连改都改不了:那 8 条根本没有格子可以点。一个越界的分数不是小瑕疵,它是「说的」与
 * 「做的」当场分家 —— 后台正是 Founder 用来判断「知识库调好了没有」的那块表。
 *
 * 修法:已填计数与家族覆盖率都改从**同一个真值集合**(`familyModes()` 派生)过滤。
 * 旧行留在库里被无视即可 —— 无视一条读不到的旧行,和删掉商家的数据,是两回事。
 */
import { describe, it, expect } from "vitest";
import { MODEL_FAMILIES, familyModes } from "@fikirtive/core";
import { countFilledRealCells, realDirectiveCellKeys, seededRealFamilies } from "../admin-v2";

/** 真格集合 = 后台网格渲染的那几格(与 admin-v2 内部同一条派生)。 */
const REAL = new Set(MODEL_FAMILIES.flatMap((f) => familyModes(f).map((m) => `${f}:${m}`)));

type Row = { family: string; mode: string; directive: string; enabled: boolean };
const row = (family: string, mode: string, over?: Partial<Row>): Row => ({
  family, mode, directive: "some directive text", enabled: true, ...over,
});

describe("#647 T6 修复轮 P1-2:已填计数只数真格", () => {
  it("真值集合就是网格渲染的那五格", () => {
    expect(realDirectiveCellKeys()).toEqual(REAL);
    expect(realDirectiveCellKeys().size).toBe(5);
  });

  it("库里躺着下架家族的旧种子 ⇒ 计数只数真格,绝不越过总数", () => {
    const rows: Row[] = [
      // 三条真格(T6 之后的种子)
      row("seedream", "t2i"), row("seedream", "i2i"), row("seedance", "t2v"),
      // 十条 T6 之前留下的历史行:家族已下架,界面上没有格子,读路也永远取不到
      row("kling", "t2v"), row("kling", "i2v"), row("kling", "i2v-tail"),
      row("ltx", "t2v"), row("ltx", "i2v"), row("veo", "t2v"),
      row("wan", "t2v"), row("pixverse", "t2v"), row("grok", "t2v"), row("hailuo", "t2v"),
    ];
    expect(countFilledRealCells(rows)).toBe(3);
    expect(countFilledRealCells(rows)).toBeLessThanOrEqual(realDirectiveCellKeys().size);
  });

  it("跨 kind 的旧行(真家族 × 错模式)同样不算 —— 它也是一格读不到的格子", () => {
    const rows: Row[] = [row("seedream", "t2i"), row("seedream", "t2v"), row("seedance", "t2i")];
    expect(countFilledRealCells(rows)).toBe(1);
  });

  it("空文本 / 已停用的真格不算已填(既有口径,一字不动)", () => {
    const rows: Row[] = [
      row("seedream", "t2i"),
      row("seedream", "i2i", { directive: "   " }),
      row("seedance", "t2v", { enabled: false }),
    ];
    expect(countFilledRealCells(rows)).toBe(1);
  });

  it("五格填满 ⇒ 5/5,分数封顶在总数上", () => {
    const rows: Row[] = [...REAL].map((k) => {
      const [family, mode] = k.split(":") as [string, string];
      return row(family, mode);
    });
    expect(countFilledRealCells(rows)).toBe(realDirectiveCellKeys().size);
  });

  it("家族覆盖率同样只认真格的行(旧行不许把覆盖率刷上去)", () => {
    const rows: Row[] = [row("kling", "t2v"), row("veo", "t2v"), row("seedance", "t2i")];
    expect(seededRealFamilies(rows).size).toBe(0);
    expect(seededRealFamilies([...rows, row("seedance", "t2v")])).toEqual(new Set(["seedance"]));
  });
});
