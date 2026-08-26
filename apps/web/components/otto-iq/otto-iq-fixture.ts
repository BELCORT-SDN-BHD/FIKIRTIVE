/**
 * otto-iq-fixture.ts —— Otto IQ 那几个格子在样张里**存在哪**,以及怎么往里放一条。
 *
 * 这几行本来住在 `R22OttoIQView.tsx` 的私有作用域里。搬出来的理由只有一个:研究托付
 * (商家给一个网址,Otto 整理好之后请他 approve)批准的那一下,落的必须是**同一个格子**。
 * 各写各的键 = 商家在线程里读到「已经存进 Brand voice」,推开 Otto IQ 那扇门却什么都没有,
 * 而且两边谁都不会报错。
 *
 * 键名不变(`r22:otto-iq:saved:v1`),搬家不动数据。
 */
import type { MemoryRow } from "@/lib/memory-actions";
import { scopedR22FixtureKey } from "@/components/r22/r22-workspace-fixture";

/** 样张里「商家已经收下的 context」存放处。工作区后缀由 `scopedR22FixtureKey` 加。 */
export const OTTO_IQ_FIXTURE_SAVED_KEY = "r22:otto-iq:saved:v1";

/** 落盘时 `Date` 会变成字符串,读回来要还原 —— 这就是那一份「盘上的形状」。 */
type StoredRow = Omit<MemoryRow, "updatedAt"> & { updatedAt: string };

export function readOttoIQSavedRows(): MemoryRow[] {
  try {
    const stored = window.sessionStorage.getItem(scopedR22FixtureKey(OTTO_IQ_FIXTURE_SAVED_KEY));
    if (!stored) return [];
    const parsed = JSON.parse(stored) as StoredRow[];
    return Array.isArray(parsed) ? parsed.map((row) => ({ ...row, updatedAt: new Date(row.updatedAt) })) : [];
  } catch {
    return [];
  }
}

export function writeOttoIQSavedRows(rows: MemoryRow[]): void {
  try {
    window.sessionStorage.setItem(scopedR22FixtureKey(OTTO_IQ_FIXTURE_SAVED_KEY), JSON.stringify(rows));
  } catch {
    /* The surface still works without refresh recovery. */
  }
}

/**
 * 放一条进去(同 id 覆盖,不堆两条)。
 *
 * 幂等靠 id:商家可能在同一张卡上按两次 Approve(手抖,或刷新之后又按了一次),
 * Otto IQ 里不该因此多出一条一模一样的 context。
 */
export function appendOttoIQSavedRow(row: MemoryRow): void {
  writeOttoIQSavedRows([...readOttoIQSavedRows().filter((item) => item.id !== row.id), row]);
}
