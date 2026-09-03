/**
 * Elements 的类型与那一条分栏规则(前端基线规格 §7.1 段②)。
 *
 * 与读取分家,是因为浏览器那一端也要认这些类型,而读取本身是 server-only。
 */

/** 设计里那几栏的产品名。Clothes 没有对应的 `EntityType`,所以这里根本没有它。 */
export type LibraryElementKind = "products" | "characters" | "official-avatars" | "locations";

export type LibraryElement = {
  id: string;
  kind: LibraryElementKind;
  name: string;
  /** 封面 —— 真有一张存在的参考图才给;没有就 null,卡片画占位而不是画一个坏图。 */
  coverUrl: string | null;
  /** 关联媒体数 = 这个元素身上的基础参考图张数(设计卡片上的 "linked media count")。 */
  mediaCount: number;
};

/** Elements 的栏目名 —— 顺序与已批准设计 README §3.5 同序(去掉没有数据来源的 Clothes)。 */
export const LIBRARY_ELEMENT_VIEWS: readonly { value: LibraryElementKind; label: string }[] = [
  { value: "products", label: "Products" },
  { value: "characters", label: "Characters" },
  { value: "official-avatars", label: "Official avatars" },
  { value: "locations", label: "Locations" },
];

/**
 * `EntityType` + `catalogKey` → 设计的栏目。
 *
 * BRANDMARK 落在 `null`:已批准的 Elements 里**没有**这一栏,而临时发明一栏就是在设计之外
 * 自造表面。这一类元素本轮因此不在 Library 里露面(PR 描述里作为待裁项登记)。
 */
export function libraryElementKind(type: string, catalogKey: string | null): LibraryElementKind | null {
  if (type === "PRODUCT") return "products";
  if (type === "LOCATION") return "locations";
  if (type === "CHARACTER") return catalogKey ? "official-avatars" : "characters";
  return null;
}

/** 地址里的 `?element=` —— 认不出来就落回第一栏。 */
export function parseLibraryElementView(raw: string | undefined): LibraryElementKind {
  return LIBRARY_ELEMENT_VIEWS.some((item) => item.value === raw)
    ? (raw as LibraryElementKind)
    : "products";
}
