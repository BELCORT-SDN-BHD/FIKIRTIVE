/**
 * **实体来源与能力 —— 「官方演员只读」的单一源头**
 *
 * Founder 2026-08-30 裁决(`apps/web/design-system/information-architecture/README.md`
 * Elements 那一行,另见 `core-flows.md` §11):
 *
 *   > Official avatars 由 Fikirtive 提供、read-only;Founder 可以 browse / search /
 *   > preview / favorite / use,但不能修改 identity。其生成结果属于 Founder 并进入
 *   > Generation history。
 *
 * 这条规矩要在四层同时成立(DTO、UI、server action、域层),而**判据只能有一份**
 * (CLAUDE.md §7.3)。判据就是这个文件里的两个纯函数:
 *
 *   `entityOrigin(entity)`     —— 这一行是平台目录的,还是商家自己的?
 *   `entityCapabilities(entity)` —— 那它允许哪些改动?
 *
 * ── 判据是 `catalogKey`,不是名字 ────────────────────────────────────────────
 *
 *   `Entity.catalogKey`(`packages/db/prisma/schema.prisma`)非空 ⇒ 这一行是播种脚本
 *   从平台目录建出来的(`apps/web/lib/actor-library-seed.ts`),`(ownerId, catalogKey)`
 *   唯一。商家自己建的元素这一格永远是 null。
 *
 *   **绝不许**改用名字判断(`name === "Aisyah"`):元素名是商家随时能改的自由文本,
 *   而且商家完全可以自己建一个也叫 Aisyah 的角色 —— 那是他自己的,他有权改。
 *
 * ── 为什么是能力表而不是一个布尔 ────────────────────────────────────────────
 *
 *   调用点读的是**动作的名字**(`capabilities.createVariant`),不是「是不是官方」。
 *   这样每加一个会改到实体的动作,就必须先在这张表里给自己开一格 —— 忘了开格
 *   是编译错误,不是一条悄悄绕过围栏的新路。今天官方目录一格不开、商家实体全开;
 *   哪天要放开某一格(例如允许给官方演员做私有变体),改的也只有下面那张表。
 *
 * 本文件是**叶子模块**:不 import 任何东西,不碰 fs/node —— 它同时被浏览器侧的 UI
 * (经 DTO)、服务端的 action 和测试读。
 */

/** 这一行实体是谁的。 */
export type EntityOrigin =
  /** Fikirtive 的平台目录(演员库五人等),商家只读。 */
  | "OFFICIAL_CATALOG"
  /** 商家自己建的元素。 */
  | "USER";

/**
 * 会改到这一行实体(或它的下属变体)的动作,一格一个。
 *
 * 键名对着真正的 server action,好让守卫一眼可读:
 *   `mutateBase`        → refgen-actions.setBaseAsset(换定锚图)
 *   `createVariant`     → refgen-actions.createVariant(付费)
 *   `regenerateVariant` → refgen-actions.regenerateVariant(付费)
 *   `renameVariant`     → refgen-actions.renameVariant
 *   `deleteVariant`     → refgen-actions.deleteVariant
 *   `editIdentity`      → actions.updateEntity / addEntityAlias / removeEntityAlias /
 *                         softDeleteReferenceImage(名字、类型、别名、备注、禁写、参考照)
 *   `deleteEntity`      → actions.softDeleteEntity
 */
export interface EntityCapabilities {
  mutateBase: boolean;
  createVariant: boolean;
  regenerateVariant: boolean;
  renameVariant: boolean;
  deleteVariant: boolean;
  editIdentity: boolean;
  deleteEntity: boolean;
}

/** 判据本身:只有 `catalogKey` 这一格。 */
export interface EntityOriginInput {
  catalogKey?: string | null;
}

const OFFICIAL_CATALOG_CAPABILITIES: Readonly<EntityCapabilities> = {
  mutateBase: false,
  createVariant: false,
  regenerateVariant: false,
  renameVariant: false,
  deleteVariant: false,
  editIdentity: false,
  deleteEntity: false,
};

const USER_CAPABILITIES: Readonly<EntityCapabilities> = {
  mutateBase: true,
  createVariant: true,
  regenerateVariant: true,
  renameVariant: true,
  deleteVariant: true,
  editIdentity: true,
  deleteEntity: true,
};

/**
 * 商家读到的拒绝原话。**只有这一句**,四层共用 —— server action 拿它当 `{ error }`,
 * 测试拿它当断言,UI 根本不该看到它(UI 按能力表压根不画那些控件)。
 *
 * 口径照 Founder 裁决:能用、能引用,不能改身份。English sentence case(项目 UI copy 规矩)。
 */
/**
 * 官方目录那一枚标签上的字。**只有这一句**,Library 的元素弹层与 Cast 的变体弹层共用 ——
 * 商家在两个面上看到的必须是同一个事实,而不是两份各自漂移的字面量。
 *
 * 它和上面那句拒绝话分工不同:拒绝话是 server action 拒下来时的 `{ error }`,商家很少看到;
 * 这一句是**平时就挂在标题旁**的说明,只读要看得见,而不是靠「按钮怎么少了」去猜。
 * English sentence case(项目 UI copy 规矩)。
 */
export const OFFICIAL_CATALOG_BADGE = "Official avatar · Read only";

export const OFFICIAL_CATALOG_REFUSAL =
  "This cast member is provided by Fikirtive — use it in Canvas or an @ mention, but its identity can't be changed.";

/** 这一行实体是谁的。`catalogKey` 非空即平台目录。 */
export function entityOrigin(entity: EntityOriginInput): EntityOrigin {
  const key = entity.catalogKey;
  return typeof key === "string" && key.length > 0 ? "OFFICIAL_CATALOG" : "USER";
}

/** 这一行实体允许哪些改动。 */
export function entityCapabilities(entity: EntityOriginInput): EntityCapabilities {
  return capabilitiesForOrigin(entityOrigin(entity));
}

/** 来源 → 能力表。DTO 已经带了 `origin` 时用这一支,不必回头再看 `catalogKey`。 */
export function capabilitiesForOrigin(origin: EntityOrigin): EntityCapabilities {
  return { ...(origin === "OFFICIAL_CATALOG" ? OFFICIAL_CATALOG_CAPABILITIES : USER_CAPABILITIES) };
}
