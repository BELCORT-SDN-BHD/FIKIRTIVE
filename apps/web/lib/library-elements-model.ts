/**
 * Elements 的类型与那一条分栏规则(前端基线规格 §7.1 段②)。
 *
 * 与读取分家,是因为浏览器那一端也要认这些类型,而读取本身是 server-only。
 */
import type { EntityCapabilities, EntityOrigin } from "@fikirtive/core";


/**
 * 设计里那几栏的产品名,加一栏 `brandmarks`。
 *
 * Clothes 没有对应的 `EntityType`,所以这里根本没有它 —— 那一栏今天没有数据来源。
 * `brandmarks` 方向相反:`BRANDMARK` 是**今天就存在**的 `EntityType`(`lib/actions.ts` 的
 * `ENTITY_TYPES` 收它、`packages/otto` 的 manage-entities 能创建它、`MentionInput` 在
 * 提示词里认它、`ChangeEntityTypeDialog` 能把别的元素改成它),只是已批准的 Elements 设计
 * 没画它。设计里没有 ≠ 商家没有:漏掉这一栏,商家保存的 brand mark 就再也看不见,连删掉
 * 它的唯一入口(`softDeleteEntity`)也一起消失,而 Otto 那边还在照常回一句「已保存」——
 * 规格 §1 九问3 禁的正是这种假成功。所以按前端规则第②条,用设计自己的分栏与卡片把它画出来,
 * 待 Founder 在 FRONT-A14 过目时另裁(PR 描述 §「生产新增、设计未明说」已登记)。
 */
export type LibraryElementKind =
  | "products"
  | "characters"
  | "official-avatars"
  | "locations"
  | "brandmarks";

export type LibraryElement = {
  id: string;
  kind: LibraryElementKind;
  name: string;
  /**
   * 这一行是谁的、允许改哪些格 —— 判据只有 `packages/core/src/entity-policy.ts` 一份
   * (Founder 2026-08-30「Official avatars 由 Fikirtive 提供、read-only」;四层落位见
   * `lib/dto.ts:toEntityDTO`)。Library 这一读跟 `EntityDTO` 用**同一对**字段名与同一个
   * 函数,所以 Library 卡片与 Otto 那边永远不会对「这一行能不能删」得出两个答案。
   * `kind === "official-avatars"` 是**分栏**,不是权限 —— 绝不拿它当判据。
   */
  origin: EntityOrigin;
  capabilities: EntityCapabilities;
  /** 封面 —— 真有一张存在的参考图才给;没有就 null,卡片画占位而不是画一个坏图。 */
  coverUrl: string | null;
  /** 关联媒体数 = 这个元素身上的基础参考图张数(设计卡片上的 "linked media count")。 */
  mediaCount: number;
};

/**
 * Elements 的栏目名 —— 前四栏与已批准设计 README §3.5 同序(去掉没有数据来源的 Clothes);
 * 设计里没有的 `Brand marks` 排在最后,不打乱设计自己的顺序。名字与商家在别处看到的同一个
 * 词对齐(`MentionInput` 与 `ChangeEntityTypeDialog` 都写 "Brand mark")。
 */
export const LIBRARY_ELEMENT_VIEWS: readonly { value: LibraryElementKind; label: string }[] = [
  { value: "products", label: "Products" },
  { value: "characters", label: "Characters" },
  { value: "official-avatars", label: "Official avatars" },
  { value: "locations", label: "Locations" },
  { value: "brandmarks", label: "Brand marks" },
];

/**
 * `EntityType` + `catalogKey` → 设计的栏目。认不出来的类型仍然落 `null`(不画一个空壳栏),
 * 但今天四个真实类型一个都不漏。
 */
export function libraryElementKind(type: string, catalogKey: string | null): LibraryElementKind | null {
  if (type === "PRODUCT") return "products";
  if (type === "LOCATION") return "locations";
  if (type === "CHARACTER") return catalogKey ? "official-avatars" : "characters";
  if (type === "BRANDMARK") return "brandmarks";
  return null;
}

/** 地址里的 `?element=` —— 认不出来就落回第一栏。 */
export function parseLibraryElementView(raw: string | undefined): LibraryElementKind {
  return LIBRARY_ELEMENT_VIEWS.some((item) => item.value === raw)
    ? (raw as LibraryElementKind)
    : "products";
}
