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
  getCoworkThread,
  getCoworkThreads,
  getEntities,
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
  /** 这个 project 的会话;最近那一条带完整消息,其余是 meta。 */
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
 * 失败一律返回 `{ error }` 而不是抛 —— 面板是随处可见的一层壳,它坏掉不该把商家正在看的
 * 那一页也一起带走。
 */
export async function loadOttoPanelSeed(): Promise<OttoPanelSeed | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return { error: gate.error };

  // 自己开帧之前先让它开完自己的 —— 两个帧套着跑没有意义,读起来也像是漏了一层。
  const ensured = await getOrCreateDefaultProject();
  if ("error" in ensured) return { error: ensured.error };
  const accountResult = await getMyAccount();

  const { ownerId } = gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<OttoPanelSeed | { error: string }> => {
    const [entities, threadRows, userName] = await Promise.all([
      getEntities(ownerId),
      getCoworkThreads(ownerId, ensured.id),
      ottoGreetingNameFromProfile(getMyProfileNames),
    ]);

    let threads = threadRows.map(toChatThreadMetaDTO);
    const openThreadId = threadRows[0]?.id ?? null;
    if (openThreadId) {
      const full = await getCoworkThread(ownerId, openThreadId);
      if (full) {
        const urls = await resolveCoworkResultUrls(ownerId, [full]);
        const dto = toChatThreadDTO(full, urls);
        threads = threads.map((t) => (t.id === dto.id ? dto : t));
      }
    }

    return {
      projectId: ensured.id,
      entities: entities.map(toEntityDTO),
      threads,
      activeThreadId: openThreadId,
      balanceUsd: "error" in accountResult ? 0 : accountResult.balanceUsd,
      userName,
    };
  });
}
