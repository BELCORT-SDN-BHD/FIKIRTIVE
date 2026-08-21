"use server";
/**
 * otto-panel-seed.ts — 面板里那段会话需要的最小一份数据,按需取一次。
 *
 * 规格:`docs/specs/wave2-shell.md` §3.4;票 #994(W2-7)挂载项。
 *
 * 为什么不是在 layout 里服务端取好:面板挂在**每一个**商家表面上,而 `/login`、`/signup`
 * 这些面根本没有商家。把这几条查询放进共享 layout,等于让每一次页面渲染都先跑一遍
 * Otto 的数据装配 —— 包括商家今天根本没打开过面板的那些次。所以取数放在这里,由面板
 * 真的要画会话时才调(客户端 → 这个 server action)。**调几次说准确**(判官 r1 P3-5):
 * 面板开着期间路由怎么切都不重取(壳不卸载),但关一次再开一次会再取一次 —— 面板收起时
 * `OttoPanel` 整个卸载。为什么不把那一次缓存掉,理由写在 `OttoPanelConversation.tsx` 顶部
 * (一句话:种子里带 `balanceUsd`,缓存会把 credits 冻住)。
 *
 * 为什么不是新写一套读:每一条都是 `/otto` 那一页今天已经在用的同一个函数
 * (`getEntities` / `getCoworkThreads` / `getCoworkThread` / `getMyAccount` / 问候名),
 * 只是少取了旧壳那些面才要的东西(analytics、ads、memory、brand records…)。
 *
 * 租户:`requireOwner()` 决定 ownerId,再进 `runAsUser` 帧 —— 与 `cowork-fetch.ts` 同一条
 * B1 缝(#464 ②-B)。客户端传进来的东西一个都没有,也就没有可以被伪造的 ownerId。
 */
import { runAsUser } from "@fikirtive/db/principal";
import { getOrCreateDefaultProject } from "./actions";
import { getMyAccount } from "./account-actions";
import { requireOwner, resolveUserPrincipal } from "./auth-guard";
import {
  getAllCoworkThreadMetas,
  getCoworkThread,
  getEntities,
  getProjects,
  resolveCoworkResultUrls,
} from "./data";
import { toChatThreadDTO, toChatThreadMetaDTO, toEntityDTO } from "./dto";
import { ottoGreetingNameFromProfile } from "./otto-greeting";
import { getMyProfileNames } from "./profile-names";
import type { ChatThreadDTO, EntityDTO } from "./types";

/** 面板画一段会话所需的全部事实,一次给齐。 */
export type OttoPanelSeed = {
  /** 新会话开在哪个 project(商家没有 project 时会先建一个,与 `/otto` 同一条)。 */
  projectId: string;
  /** @提及要用的清单。 */
  entities: EntityDTO[];
  /** 会话历史用的项目清单(W2-8:面板头部那份列表按项目分组)。 */
  projects: { id: string; name: string; pinnedAt: string | null }[];
  /**
   * **每一个** project 的会话 meta(W2-8 起)。
   *
   * 从前这里只有当前 project 那一份 —— 面板里的历史列表要按项目分组,拿一个 project 的
   * 会话画不出分组。取的是 `/otto` 那条侧栏今天用的同一个函数
   * (`getAllCoworkThreadMetas`),不是为面板另写一条查询。最近那一条带完整消息。
   */
  threads: ChatThreadDTO[];
  /** 打开时停在哪一条;没有会话就是 null(面板画前门)。 */
  activeThreadId: string | null;
  balanceUsd: number;
  /** 问候语里的称呼。 */
  userName: string;
};

/**
 * 取一次面板的会话种子。
 *
 * `select` 是深链的落点(规格书 §2.2/§2.5,`/otto?project=P&thread=T` 那条旧地址重定向
 * 到 `/?otto=1&project=P&thread=T` 之后要接得住):`projectId` 给了就优先用它当「打开时
 * 停在哪个 project」,不给或者给了一个不是这个商家自己的 project 就落回
 * `getOrCreateDefaultProject()` 那一条(与不带 `select` 调用时完全同一条路径,行为不变)。
 * `threadId` 同理,而且必须落在**最终选中的那个 project** 上 —— 地址栏说的项目与会话
 * 必须是同一件事,不能商家点开的其实是另一个 project 底下的会话。两者都在 `runAsUser`
 * 帧内、对着已经按 `ownerId` 查出来的 `projectRows`/`threadRows` 核验,不是拿商家传来的
 * id 直接查库(那就又开了一个可以被伪造 ownerId 的口子)——核不过就当没给,回落默认,
 * 不抛错、不炸。
 *
 * 失败一律返回 `{ error }` 而不是抛 —— 面板是随处可见的一层壳,它坏掉不该把商家正在看的
 * 那一页也一起带走。
 */
export async function loadOttoPanelSeed(
  select?: { projectId?: string; threadId?: string },
): Promise<OttoPanelSeed | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return { error: gate.error };

  // 自己开帧之前先让它开完自己的 —— 两个帧套着跑没有意义,读起来也像是漏了一层。
  const ensured = await getOrCreateDefaultProject();
  if ("error" in ensured) return { error: ensured.error };
  const accountResult = await getMyAccount();

  const { ownerId } = gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<OttoPanelSeed | { error: string }> => {
    const [entities, projectRows, threadRows, userName] = await Promise.all([
      getEntities(ownerId),
      getProjects(ownerId),
      getAllCoworkThreadMetas(ownerId),
      ottoGreetingNameFromProfile(getMyProfileNames),
    ]);

    let threads = threadRows.map(toChatThreadMetaDTO);

    // 深链 project:必须是这个商家自己的项目,查不到就当没给。
    const requestedProjectId = select?.projectId && projectRows.some((p) => p.id === select.projectId)
      ? select.projectId
      : null;
    const activeProjectId = requestedProjectId ?? ensured.id;

    // 打开时停在**当前 project** 最近那一条,或者深链点名的那一条(同样必须是这个商家
    // 自己的会话,而且落在刚定下来的 project 上)—— 与 W2-7 逐字同义,只多了深链这一条
    // 优先级更高的分支。列表现在覆盖每一个 project,但「面板一打开接着聊哪一条」不跟着
    // 变宽,那是另一个决定。
    const requestedThreadId = select?.threadId
      && threadRows.some((t) => t.id === select.threadId && t.projectId === activeProjectId)
      ? select.threadId
      : null;
    const openThreadId = requestedThreadId ?? threadRows.find((t) => t.projectId === activeProjectId)?.id ?? null;
    if (openThreadId) {
      const full = await getCoworkThread(ownerId, openThreadId);
      if (full) {
        const urls = await resolveCoworkResultUrls(ownerId, [full]);
        const dto = toChatThreadDTO(full, urls);
        threads = threads.map((t) => (t.id === dto.id ? dto : t));
      }
    }

    return {
      projectId: activeProjectId,
      entities: entities.map(toEntityDTO),
      projects: projectRows.map((p) => ({
        id: p.id,
        name: p.name,
        pinnedAt: p.pinnedAt ? p.pinnedAt.toISOString() : null,
      })),
      threads,
      activeThreadId: openThreadId,
      balanceUsd: "error" in accountResult ? 0 : accountResult.balanceUsd,
      userName,
    };
  });
}
