/**
 * 素材包(Library pack)的共享存档 —— **画布这一面往里写,Library 那一面读**。
 *
 * 两面各自有自己的组件与状态,唯一必须逐字对上的只有两样:存档的**键名**和记录的**形状**。
 * 所以它们只住在这一个文件里:谁要加一个字段,改这里,两面一起动;各写各的键名 = 两面
 * 从此看不见对方存的东西,而且谁都不会报错。
 *
 * 幂等由 `id` 保证:同一张图加两次只留一条,`added` 会如实说这一次有没有真的加进去 ——
 * 商家不该因为多按一下就在包里看到两张一样的图。
 */
import { scopedR22FixtureKey } from "@/components/r22/r22-workspace-fixture";

/** 存档键(实际落盘时还会带上当前 workspace 的后缀,见 `scopedR22FixtureKey`)。 */
export const R22_PACK_STORAGE_KEY = "r22:library:pack";
/** 形状变了就把这个数字 +1;读到对不上的版本一律当成「还没有包」,不去猜旧形状。 */
export const R22_PACK_VERSION = 1;
/** 同一个 tab 里 Library 面想立刻跟着刷新,监听这个事件即可。 */
export const R22_PACK_EVENT = "r22:library-pack-change";

export type R22PackItem = {
  /** 素材的稳定身份 —— 同一张图第二次加入时靠它认出来。 */
  id: string;
  /** 商家读到的名字,例如 `Image 1`。 */
  label: string;
  src: string;
  /** 这条是从哪一面加进来的。今天只有画布一面。 */
  from: "canvas";
  addedAt: string;
};

export type R22PackArchive = { version: number; items: R22PackItem[] };

function packKey(): string {
  return scopedR22FixtureKey(R22_PACK_STORAGE_KEY);
}

export function readR22Pack(): R22PackItem[] {
  try {
    const stored = window.sessionStorage.getItem(packKey());
    if (!stored) return [];
    const parsed = JSON.parse(stored) as Partial<R22PackArchive>;
    if (parsed?.version !== R22_PACK_VERSION || !Array.isArray(parsed.items)) return [];
    return parsed.items.filter((item): item is R22PackItem => typeof item?.id === "string" && typeof item?.src === "string");
  } catch {
    return [];
  }
}

/** 加一条进包。已经在包里就原样不动,`added` 为 false —— 多按一下不该变成两张一样的图。 */
export function addToR22Pack(item: { id: string; label: string; src: string }): { added: boolean; total: number } {
  const items = readR22Pack();
  const already = items.some((existing) => existing.id === item.id);
  const next = already ? items : [...items, { ...item, from: "canvas" as const, addedAt: new Date().toISOString() }];
  if (!already) {
    try {
      window.sessionStorage.setItem(packKey(), JSON.stringify({ version: R22_PACK_VERSION, items: next } satisfies R22PackArchive));
    } catch {
      /* 存不下也不该把商家的这一次操作变成一个报错弹窗;下面照实回一个总数。 */
    }
    window.dispatchEvent(new CustomEvent(R22_PACK_EVENT, { detail: { total: next.length } }));
  }
  return { added: !already, total: next.length };
}
