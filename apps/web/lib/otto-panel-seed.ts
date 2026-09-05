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
import { isPanelThread } from "./otto-thread-surface";
import { getMyProfileNames } from "./profile-names";
import type { ChatThreadDTO, EntityDTO } from "./types";

/** 面板画一段会话所需的全部事实,一次给齐。 */
export type OttoPanelSeed = {
  /**
   * 新会话开在哪个 project(商家没有 project 时会先建一个,与 `/otto` 同一条)。
   *
   * 续上了某一条面板对话时,跟着**那一条**走 —— 项目与会话是同一件事(#1200 判官 P2-2)。
   */
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
  /**
   * 打开时停在哪一条;没有可续的就是 null(面板画新对话态)。
   *
   * FRONT-A14:只在**面板自己开的**对话里选(`surface === "panel"`),不再是「这个
   * project 最近的一条」—— 后者会把画布对话摊到 /billing 这种毫不相干的页面上。
   * 选的范围是**全店**(先当前 project,再退到全店最近那一条),与展开信号同一口径 ——
   * 深链点名了 project 也一样回落(#1215 判官 P2-2),那条例外会让空面板原样复现。
   */
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

    // 深链点名的那一条(同样必须是这个商家自己的会话,而且落在刚定下来的 project 上)。
    // 深链是商家**自己点名**的到达,点名什么就开什么 —— 画布对话经由 `?thread=` 打开
    // 照旧,不受下面那条自动续接的规则影响。
    const requestedThreadId = select?.threadId
      && threadRows.some((t) => t.id === select.threadId && t.projectId === activeProjectId)
      ? select.threadId
      : null;

    // 没有深链时**接着聊哪一条**(FRONT-A14;Codex 全 beta 审计 P1-010)。
    //
    // 从前这里是「这个 project 里最近的一条」,而 `activeProjectId` 来自
    // `getOrCreateDefaultProject()` —— 与商家从哪一页展开面板毫无关系。于是商家在
    // /billing 点开侧栏,面板摊开的是一条画布对话「Professional Male Model Image」:
    // 一段他不是在这里开的、与这一页无关的上下文,而且没有任何地方写着它是画布的。
    //
    // 现在的判据只有一句:**面板只自动续面板自己开的对话**(`surface === "panel"`)。
    // 画布对话只在商家从会话列表里显式点选、或深链点名时才打开。一条都没有就**不预选**
    // (`null`)—— 面板画新对话态,商家发出第一句时才建线程,并登记成 `panel`。
    //
    // 老行(这一票之前的每一条)`surface` 是 `null`,一律按画布读,理由与代价写在
    // `lib/otto-thread-surface.ts`:宁可让面板少续一条老对话,也不要它继续摊开别处的上下文。
    //
    // 落座口径与展开信号同一句话:**全店**(#1200 判官 P2-2)。展开信号那一边
    // (`hasPendingPanelThread`)按 ownerId 查、不带 project;这一边从前只在
    // `activeProjectId` 里选,两者口径不一致时商家看到的是:一条在别的 project 里跑着的
    // 面板对话把面板顶开,而面板打开后画的是新对话空态 —— 凭空弹出来一块空面板。所以
    // 当前 project 里没有面板对话时,就往全店的面板对话里续最近那一条,并让
    // 「停在哪个 project」跟着它走(项目与会话必须是同一件事,与深链那条同一个规矩)。
    //
    // 深链点名了 project 也走同一条回落(#1215 判官 P2-2)。这里从前留过一个例外
    // (「地址栏点了名就不跨 project」),而信号那一边不认识 project:深链
    // `/?otto=1&project=P` 进来、P 里一条面板对话都没有时,信号照样答「有」把面板顶开,
    // 面板却选不到任何一条 —— 同一块凭空弹出来的空面板原样复现,只是换了个入口。所以
    // 点名的 project 里有面板对话就用它(地址栏说的仍然优先),没有就退到全店最近那一条,
    // 「停在哪个 project」跟着它走。深链点名的**会话**(`?thread=`)不受影响:那是商家
    // 逐字点名的一条,上面那一支直接命中。
    const seatedThread = requestedThreadId
      ? threadRows.find((t) => t.id === requestedThreadId)
      : threadRows.find((t) => t.projectId === activeProjectId && isPanelThread(t.surface))
        ?? threadRows.find((t) => isPanelThread(t.surface));
    const openThreadId = seatedThread?.id ?? null;
    const panelProjectId = seatedThread?.projectId ?? activeProjectId;
    if (openThreadId) {
      const full = await getCoworkThread(ownerId, openThreadId);
      if (full) {
        const urls = await resolveCoworkResultUrls(ownerId, [full]);
        const dto = toChatThreadDTO(full, urls);
        threads = threads.map((t) => (t.id === dto.id ? dto : t));
      }
    }

    return {
      projectId: panelProjectId,
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
