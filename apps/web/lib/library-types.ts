/**
 * 素材库的**类型化 ID** 与展示形状(规格 docs/specs/frontend-baseline.md §7.3②;
 * 验收 FRONT-A5 / FRONT-A6 / FRONT-A7)。
 *
 * 这个文件刻意**不碰数据库、不 import server-only** —— 客户端组件也要用到这里的类型与
 * 那两个纯函数,而收藏 / 合集的服务端读写住在 `library-subjects.ts`、`library-favorites.ts`
 * 与 `library-collections.ts`。类型与查询分家,是为了让客户端只拿走它真正需要的那一半。
 *
 * 收藏与合集存的都不是外键,而是一对 `(subjectType, subjectId)`。理由写在迁移注释里:
 * 收藏是一条**链接**,取消收藏不许删原对象,而外键的 ON DELETE 语义会把这两件事焊死。
 * 代价是「这个 id 还在不在、是不是这个租户的」没有数据库替我们答 —— 所以每一次写入之前
 * 都要重新问一遍(`filterVisibleSubjects`),读回时再 resolve 成真实对象
 * (`resolveLibrarySubjects`)。URL 里的 id 永远只是一个待校验的定位参数。
 *
 * 今天只有一个合法类型 `"generation"`。上传在本仓库也是一行 `source = UPLOAD` 的
 * Generation(见 `lib/upload-actions.ts` 的 `finalizeCandidateUploads`),所以「生成结果与
 * 上传混在同一个收藏列表里」这件设计要求,一个类型就覆盖得了。表的形状已经准备好接别的
 * 类型(Founder 2026-09-03 裁决十:不分素材类型);但新类型开放之前必须先有它自己的真实
 * 读模型,否则就是「无契约的控件」(裁决九)。
 */
export const LIBRARY_SUBJECT_TYPES = ["generation"] as const;

export type LibrarySubjectType = (typeof LIBRARY_SUBJECT_TYPES)[number];

export type LibrarySubjectRef = { subjectType: LibrarySubjectType; subjectId: string };

/** 一件素材在 Library 网格 / 详情里要用到的最小事实。 */
export type LibrarySubjectItem = {
  subjectType: LibrarySubjectType;
  subjectId: string;
  /** 生成行的 id —— 详情面板与 Use in canvas 认的就是它。 */
  id: string;
  projectId: string;
  assetId: string;
  url: string;
  kind: "image" | "video";
  prompt: string;
  /** 上传与生成在同一张表里,靠这一列分身份(设计里 Uploads 是自己的一个页签)。 */
  source: "upload" | "generated";
  /** 素材自己的创建时间(不是被收藏 / 被加进合集的时间)。 */
  createdAt: string;
};

/** 收藏页的一项:素材本身 ＋ 它**被收藏**的时间(列表按这个排,不是按素材时间)。 */
export type LibraryFavoriteItem = LibrarySubjectItem & { favoritedAt: string };

export type LibraryFavoritePage = {
  items: LibraryFavoriteItem[];
  nextCursor: string | null;
  hasMore: boolean;
};

/** 合集列表里的一张卡:封面、名字、真实成员数、最后更新时间。 */
export type LibraryCollectionSummary = {
  id: string;
  name: string;
  itemCount: number;
  updatedAt: string;
  coverUrl: string | null;
};

/** 合集详情:卡片信息 ＋ 这一页成员(成员按加入时间倒序)。 */
export type LibraryCollectionDetail = LibraryCollectionSummary & {
  items: LibraryCollectionItemView[];
};

export type LibraryCollectionItemView = LibrarySubjectItem & { addedAt: string };

export function isLibrarySubjectType(value: unknown): value is LibrarySubjectType {
  return typeof value === "string" && (LIBRARY_SUBJECT_TYPES as readonly string[]).includes(value);
}

/** `(type, id)` 的稳定字符串键 —— Map 与 Set 用它,不要在别处重新拼。 */
export function subjectKey(ref: LibrarySubjectRef): string {
  return `${ref.subjectType}:${ref.subjectId}`;
}
