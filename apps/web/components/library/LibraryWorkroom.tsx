"use client";
/* eslint-disable react-hooks/set-state-in-effect -- 非生产 R22 样张在 hydration 之后回读浏览器内的存档。 */

/**
 * LibraryWorkroom.tsx —— Library 从「陈列柜」变成「工作台」的那一层。
 *
 * 陈列柜只回答一个问题:我做过什么。工作台要回答第二个:我现在要拿这些东西干什么。所以这
 * 一层管的全是**动作**:多选、批量、素材包、上传、单图详情。
 *
 * 三处外面来的规矩,都不是这一面自己发明的:
 *   ① **Esc 不越层** —— 壳层 `R22DashboardShell` 与画布都守同一条链:进来先看
 *      `defaultPrevented`,自己吃掉了就 `preventDefault()`。少守一头,一记 Esc 就撕两层
 *      (commit 67de2bd5 付过的学费)。轮不到自己的那一记原样放过去。
 *   ② **存档升版不迁移** —— 键升到 v2,旧的 v1 形状读不出来就重新播种(approvals f0b7dc9b)。
 *   ③ **诚实** —— 屏幕上没有一句话声称我们做了做不到的事。Download 还没接上就直说没接上,
 *      移除只是从这里收起来、不冒充删除,上传超预算当场拒收、不假装成功。
 *
 * **回执只有一种长相**(2026-08-26,审计 A-4):这一面此前自己画一条 `.r22-lib-notice`,
 * 另外四扇门各画各的 —— 同一件事五种长相。现在全部走 `toast()`,Toaster 挂在
 * `app/layout.tsx` 的根布局上,措辞一个字没改。带后续动作的那两条(Continue in Canvas、
 * 隐藏之后的 Undo)走 sonner 的 `action`,不是另起一条自制的动作条。
 *
 * **可逆的动作不立模态闸**(2026-08-26,审计 C-5):Hide 只是 `hidden: true`,原图一个
 * 字节没动 —— 为它弹一次窗,是把商家的手拦在半路,而批量整理素材是一次点几十下的活。
 * 直接做,回执上给一颗 Undo。Otto IQ 的 Delete context 是**真删**,那一处的模态留着。
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast, type ExternalToast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { scopedR22FixtureKey } from "@/components/r22/r22-workspace-fixture";
import {
  appendCanvasFixtureHandoff,
  FIXTURE_VIDEO_CONCEPT_SECONDS,
  fixtureBatchHome,
  fixtureQuoteCredits,
} from "@/components/canvas/r22-canvas-fixture";

import { ImageEditLayer, IMAGE_EDIT_CREDITS, type ImageEditOutcome } from "./ImageEditLayer";
import { LibraryCard } from "./LibraryCard";
import { LibraryDetailLayer } from "./LibraryDetailLayer";
import { LibraryNav } from "./LibraryNav";
import { LibraryPackDialog } from "./LibraryPackDialog";
import { LibraryQuickCreate, type QuickCreateRequest } from "./LibraryQuickCreate";
import { LibraryToolbar } from "./LibraryToolbar";
import {
  addLibraryAssets,
  attachToPack,
  editedLibraryAsset,
  editedVersionsOf,
  groupLibraryByDay,
  libraryCanvasHref,
  libraryProjects,
  LIBRARY_FIXTURE_KEY,
  newPackId,
  packIdOf,
  QUICK_CREATE_PROJECT_ID,
  quickCreateAsset,
  readLibraryArchive,
  seedLibraryArchive,
  UPLOAD_BUDGET_BYTES,
  UPLOAD_BUDGET_LABEL,
  uploadDisplayName,
  visibleLibraryAssets,
  writeLibraryArchive,
  type LibraryArchive,
  type LibraryAsset,
  type LibraryLayout,
  type LibrarySection,
  type LibrarySort,
  type LibraryTypeFilter,
} from "./library-fixture";

const NO_ROOM = `There is no room left in this preview, so nothing was kept.`;

function countLabel(count: number): string {
  return count === 1 ? "1 item" : `${count} items`;
}

export function LibraryWorkroom({ fixture = true, restore = true, empty = false }: { fixture?: boolean; restore?: boolean; empty?: boolean }) {
  const [archive, setArchive] = useState<LibraryArchive>(() => (empty ? { assets: [], packs: [] } : seedLibraryArchive()));
  const [restored, setRestored] = useState(!restore);
  const [section, setSection] = useState<LibrarySection>("all");
  const [type, setType] = useState<LibraryTypeFilter>("all");
  const [sort, setSort] = useState<LibrarySort>("newest");
  const [layout, setLayout] = useState<LibraryLayout>("grid");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  /** 正在改哪一张。`null` = 没在改。它与详情层不会同时开着 —— 从详情层进去时那一层先关。 */
  const [editId, setEditId] = useState<string | null>(null);
  const [packTarget, setPackTarget] = useState<"selection" | string | null>(null);
  /** `null` = 没在改名。空串是「改名中,但先清空了」—— 两件事不能共用一个假值。 */
  const [renaming, setRenaming] = useState<string | null>(null);
  /** 生成条开着没有。它是页内浮层,不是路由 —— 关掉不该丢掉网格的滚动位置与多选态。 */
  const [createOpen, setCreateOpen] = useState(false);
  /** 这一次 Quick create 还在跑没有。跑着的时候发送键关着,一句话不该同时排两次。 */
  const [running, setRunning] = useState(false);
  /** 工具排上那个真的 file picker。空态里那颗 Upload 按的是**同一个** input —— 两条路
   *  一条链,不复制第二份读文件、判类型、算预算的逻辑。 */
  const uploadRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<string | null>(null);
  const timersRef = useRef<number[]>([]);
  const runSeqRef = useRef(0);
  /**
   * 存档的一面镜子。Quick create 那条延时回调跑在 920ms 之后,闭包里那份存档是**按下发送
   * 那一刻**的旧快照 —— 等待期间商家星标了一张、加了一个包、传了一张图,用旧快照合并写
   * 回去就把这几件事悄悄抹掉了。所以落地那一刻读这里,不读闭包。
   */
  const archiveRef = useRef(archive);
  useEffect(() => { archiveRef.current = archive; }, [archive]);

  useEffect(() => () => { timersRef.current.forEach((timer) => window.clearTimeout(timer)); }, []);

  useEffect(() => {
    if (!restore) return;
    setArchive(readLibraryArchive(scopedR22FixtureKey(LIBRARY_FIXTURE_KEY)));
    setRestored(true);
  }, [restore]);

  /**
   * 一次写入 = 一次落盘 + 一句人话。落不进去就照实说,不把改动留在屏幕上骗人。
   *
   * `action` 是这条回执的后续动作(sonner 的 `action`)—— 它跟着**这一条**走,上一条的
   * 动作随上一条一起消失,不会有一颗指着旧事的按钮杵在屏幕上。
   */
  const write = useCallback((next: LibraryArchive): boolean => {
    if (restore && !writeLibraryArchive(scopedR22FixtureKey(LIBRARY_FIXTURE_KEY), next)) return false;
    setArchive(next);
    return true;
  }, [restore]);

  const commit = useCallback((next: LibraryArchive, message: string, action?: ExternalToast["action"]): boolean => {
    if (!write(next)) {
      toast(NO_ROOM);
      return false;
    }
    toast(message, action ? { action } : undefined);
    return true;
  }, [write]);

  /** 只说一句话,不动东西。 */
  const say = useCallback((message: string) => {
    toast(message);
  }, []);

  const patch = useCallback((ids: string[], change: (asset: LibraryAsset) => LibraryAsset, message: string) => {
    const wanted = new Set(ids);
    commit({ ...archive, assets: archive.assets.map((asset) => (wanted.has(asset.id) ? change(asset) : asset)) }, message);
  }, [archive, commit]);

  const visible = useMemo(() => visibleLibraryAssets(archive.assets, { section, type, query, sort }), [archive.assets, section, type, query, sort]);
  const groups = useMemo(() => groupLibraryByDay(visible), [visible]);
  const live = useMemo(() => archive.assets.filter((asset) => !asset.hidden), [archive.assets]);
  const counts = useMemo(() => ({
    all: live.length,
    starred: live.filter((asset) => asset.starred).length,
    made: live.filter((asset) => asset.source === "made").length,
    uploads: live.filter((asset) => asset.source === "uploaded").length,
  }), [live]);
  const projects = useMemo(() => libraryProjects(archive.assets), [archive.assets]);
  const packCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const pack of archive.packs) out[pack.id] = live.filter((asset) => asset.packIds.includes(pack.id)).length;
    return out;
  }, [archive.packs, live]);

  const openPackId = packIdOf(section);
  const openPack = archive.packs.find((pack) => pack.id === openPackId) ?? null;
  const detail = detailId ? archive.assets.find((asset) => asset.id === detailId) ?? null : null;
  const editing = editId ? archive.assets.find((asset) => asset.id === editId) ?? null : null;
  const selectedCount = selected.length;
  const packDialogIds = packTarget === "selection" ? selected : packTarget ? [packTarget] : [];

  /* ── 多选 ─────────────────────────────────────────────────────────────────── */

  const onSelect = useCallback((asset: LibraryAsset, extend: boolean) => {
    const order = visible.map((row) => row.id);
    setSelected((current) => {
      const anchor = anchorRef.current;
      if (extend && anchor && order.includes(anchor)) {
        const from = order.indexOf(anchor);
        const to = order.indexOf(asset.id);
        const span = order.slice(Math.min(from, to), Math.max(from, to) + 1);
        return [...new Set([...current, ...span])];
      }
      anchorRef.current = asset.id;
      return current.includes(asset.id) ? current.filter((id) => id !== asset.id) : [...current, asset.id];
    });
  }, [visible]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // 详情层、编辑层与素材包弹层是 Radix 自己的地盘,那一记归它们,工作台不抢。
      if (detailId || editId || packTarget) return;
      // 生成条开着的时候那一记归它。它自己也守着同一条链,这里明写一句是因为两个监听器
      // 挂在同一个 window 上、次序由挂载顺序决定 —— 靠次序对上的东西迟早会错一次。
      if (createOpen) return;
      if (!selected.length) return;
      event.preventDefault();
      setSelected([]);
      anchorRef.current = null;
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [createOpen, detailId, editId, packTarget, selected.length]);

  /* ── 批量动作 ─────────────────────────────────────────────────────────────── */

  function bulkStar() {
    patch(selected, (asset) => ({ ...asset, starred: true }), `${countLabel(selectedCount)} starred.`);
  }

  function download() {
    say("Downloads are not switched on yet, so nothing was saved to your computer.");
  }

  /**
   * 收起来的那一批再放回去。读的是 `archiveRef.current` 而不是闭包里那份 —— 商家在按下
   * Undo 之前还能继续整理(星标、加包、再传一张),用旧快照写回去会把那几件事一起抹掉。
   */
  const restoreHidden = useCallback((ids: string[]) => {
    const wanted = new Set(ids);
    const current = archiveRef.current;
    commit(
      { ...current, assets: current.assets.map((asset) => (wanted.has(asset.id) ? { ...asset, hidden: false } : asset)) },
      `${countLabel(ids.length)} back in your Library.`,
    );
  }, [commit]);

  function removeSelected() {
    const ids = [...selected];
    if (!ids.length) return;
    const wanted = new Set(ids);
    const landed = commit(
      { ...archive, assets: archive.assets.map((asset) => (wanted.has(asset.id) ? { ...asset, hidden: true } : asset)) },
      `${countLabel(ids.length)} hidden from your Library, still in the project where they were made.`,
      { label: "Undo", onClick: () => restoreHidden(ids) },
    );
    if (landed) setSelected([]);
  }

  function removeFromPack() {
    if (!openPackId) return;
    patch(selected, (asset) => ({ ...asset, packIds: asset.packIds.filter((id) => id !== openPackId) }), `${countLabel(selectedCount)} taken out of ${openPack?.name ?? "this pack"}.`);
    setSelected([]);
  }

  function addToPack(packId: string) {
    const name = archive.packs.find((pack) => pack.id === packId)?.name ?? "the pack";
    commit(attachToPack(archive, packDialogIds, packId), `${countLabel(packDialogIds.length)} in ${name}.`);
    setPackTarget(null);
  }

  function createPack(name: string) {
    const id = newPackId(name, archive.packs);
    commit(attachToPack({ ...archive, packs: [...archive.packs, { id, name }] }, packDialogIds, id), `${countLabel(packDialogIds.length)} in ${name}.`);
    setPackTarget(null);
  }

  function renamePack() {
    const name = (renaming ?? "").trim();
    if (!openPack || !name) return setRenaming(null);
    commit({ ...archive, packs: archive.packs.map((pack) => (pack.id === openPack.id ? { ...pack, name } : pack)) }, `This pack is now called ${name}.`);
    setRenaming(null);
  }

  /* ── 改这一张 ─────────────────────────────────────────────────────────────── */

  /**
   * 一次改动落地:库里多出**新的一条**,原图一个字节都不动。
   *
   * 幂等在这里是看得见的一句话,不是一次静默的吞掉:同一张图上按第二次同一个预设,
   * `editedLibraryAsset` 给出的是同一个 id,所以这里如实回「已经改过这一版」——
   * 报一句 Done 再什么都不做,商家会以为库里多了一张,回去找却找不到。
   */
  function makeEdit(sourceAsset: LibraryAsset, change: string): ImageEditOutcome {
    const created = editedLibraryAsset({ source: sourceAsset, change });
    const current = archiveRef.current;
    if (current.assets.some((row) => row.id === created.id)) return "existing";
    return commit(addLibraryAssets(current, [created]), `${created.name} is in your Library — ${IMAGE_EDIT_CREDITS} cr.`)
      ? "added"
      : "no-room";
  }

  /* ── 上传 ─────────────────────────────────────────────────────────────────── */

  function upload(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return say("Only pictures can be added here, so that file was not added.");
    if (file.size > UPLOAD_BUDGET_BYTES) {
      return say(`${uploadDisplayName(file.name)} is larger than ${UPLOAD_BUDGET_LABEL}, so it was not added. Pick a smaller picture and it will show up here.`);
    }
    const reader = new FileReader();
    reader.onload = () => {
      const name = uploadDisplayName(file.name);
      const asset: LibraryAsset = {
        id: `upload-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${archive.assets.length + 1}`,
        poster: String(reader.result ?? ""),
        kind: "image",
        name,
        createdAt: new Date().toISOString(),
        starred: false,
        source: "uploaded",
        packIds: [],
      };
      commit({ ...archive, assets: [asset, ...archive.assets] }, `${name} is in your Library.`);
    };
    reader.onerror = () => say(`${uploadDisplayName(file.name)} could not be read, so it was not added.`);
    reader.readAsDataURL(file);
  }

  /* ── Quick create:仓库里就地做东西 ───────────────────────────────────────── */

  /**
   * 一次 Quick create 从「排上了」走到「进了库」。
   *
   * 三件事在落地那一刻**一起**发生,少一件商家就会觉得东西丢了:
   *   ① 成品进 Library 存档 —— 归 Quick create 这个项目、归今天那一组,Made by Otto 跟着 +n;
   *   ② 同一批送进那块画布的会话 —— 于是「Continue in Canvas」与详情层的「Open in canvas」
   *      指过去看到的是**同一块有东西的板**,不是一块空板;
   *   ③ 回执带上那颗动作按钮 —— 刚做完的下一步就在手边,不用自己去找路。
   *
   * 幂等由批次 `id` 保证(`appendCanvasFixtureHandoff`),来回点两次不会在板上多出一批。
   */
  function runQuickCreate(request: QuickCreateRequest) {
    if (running) return;
    runSeqRef.current += 1;
    const runId = `${Date.now()}-${runSeqRef.current}`;
    const credits = fixtureQuoteCredits(request.kind, request.count);
    setRunning(true);
    setCreateOpen(false);
    say("Otto is on it. Nothing is charged until it lands.");

    timersRef.current.push(window.setTimeout(() => {
      say("Still the same request — nothing new was started.");
    }, 320));

    timersRef.current.push(window.setTimeout(() => {
      setRunning(false);
      const made = Array.from({ length: request.count }, (_, index) => quickCreateAsset({
        runId,
        index,
        prompt: request.prompt,
        kind: request.kind,
        duration: `${FIXTURE_VIDEO_CONCEPT_SECONDS}s`,
      }));
      // 读-改-写:合并的是**此刻**的存档,不是按下发送那一刻的旧快照。
      // 先落盘、再送会话、最后才说话 —— 那句话带着「Continue in Canvas」,而那条路只有
      // 在会话真的写进去之后才通;顺序反过来,回执会指向一块空板。
      if (!write(addLibraryAssets(archiveRef.current, made))) {
        toast(NO_ROOM);
        return;
      }
      if (restore) {
        appendCanvasFixtureHandoff({
          projectId: QUICK_CREATE_PROJECT_ID,
          prompt: request.prompt,
          batch: {
            id: `quick-${runId}`,
            kind: request.kind,
            ratio: request.ratio,
            credits,
            madeFrom: null,
            references: [],
            home: fixtureBatchHome(1),
            art: made.map((asset) => ({ id: asset.id, label: asset.name, src: asset.poster, alt: asset.name })),
          },
        });
      }
      toast(
        request.kind === "video"
          ? `${countLabel(made.length)} in your Library. Video is a still stand-in, not a playable video — ${credits} cr.`
          : `${countLabel(made.length)} in your Library — ${credits} cr.`,
        {
          // 真链接,不是 onClick 转发 —— 商家可以中键新开、可以右键复制地址,而 Next 也
          // 能照常预取那一屏。sonner 的 `action` 收 ReactNode,不必为此另起一条动作条。
          action: <Link className="r22-lib-notice-act" data-r22-lib-continue href={libraryCanvasHref(QUICK_CREATE_PROJECT_ID, fixture)}>Continue in Canvas</Link>,
        },
      );
    }, 920));
  }

  /* ── 画 ───────────────────────────────────────────────────────────────────── */

  if (restore && !restored) return <section className="r22-lib-wait" aria-busy="true">Opening your Library…</section>;

  const emptyCopy = query.trim()
    ? `Nothing here matches “${query.trim()}”.`
    : section === "uploads"
      ? "No pictures of your own yet. Use Upload and they will sit here beside everything Otto made."
      : section === "made"
        ? "Otto has not made anything yet. Use Create and the first ones land here."
        : section === "starred"
          ? "Nothing starred yet. Star the keepers and they gather here."
          : "Nothing here yet. Make something in Canvas, or upload a picture of your own.";

  /**
   * 空态里那句话点名了动作,屏幕上就得有那颗按钮(审计 B-6)。
   *
   * 每一颗都通向**今天真的存在**的去处:Canvas 是 `/create` 那扇门(fixture 时带着记号),
   * Upload 按的是工具排上那个真的 file picker(同一个 input,不是第二条上传路),Create
   * 开的是这一面自己的生成条。搜索无结果与「没有星标」两个分支不点名动作,所以它们
   * 也不长按钮 —— 一句话就是全部。
   */
  const emptyActions = query.trim() || section === "starred" ? null : (
    <>
      {section !== "uploads" ? <Link className="r22-lib-empty-act" href={fixture ? "/create?fixture=r22" : "/create"}>Open Canvas</Link> : null}
      {section === "made"
        ? <Button unstyled type="button" className="r22-lib-empty-act" onClick={() => setCreateOpen(true)}>Create</Button>
        : <Button unstyled type="button" className="r22-lib-empty-act" onClick={() => uploadRef.current?.click()}>Upload a picture</Button>}
    </>
  );

  return (
    <div className="r22-lib" data-layout={layout}>
      <LibraryNav
        section={section}
        counts={counts}
        projects={projects}
        packs={archive.packs}
        packCounts={packCounts}
        onSection={(next) => { setSection(next); setSelected([]); setRenaming(null); }}
        onNewPack={() => setPackTarget("selection")}
      />

      <div className="r22-lib-main">
        <LibraryToolbar
          query={query}
          type={type}
          sort={sort}
          layout={layout}
          fixture={fixture}
          createOpen={createOpen}
          onQuery={setQuery}
          onType={setType}
          onSort={setSort}
          onLayout={setLayout}
          onFiles={upload}
          onCreate={() => setCreateOpen((open) => !open)}
          fileRef={uploadRef}
        />

        {openPack ? (
          <div className="r22-lib-packhead">
            {renaming !== null ? (
              <>
                <Input unstyled aria-label="Pack name" value={renaming} onChange={(event) => setRenaming(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); renamePack(); } }} />
                <Button unstyled type="button" onClick={renamePack}>Save name</Button>
              </>
            ) : (
              <>
                <h2>{openPack.name}</h2>
                <Button unstyled type="button" onClick={() => setRenaming(openPack.name)}>Rename</Button>
              </>
            )}
          </div>
        ) : null}

        {groups.length ? (
          <div className="r22-lib-groups">
            {groups.map((group) => (
              <section className="r22-lib-group" key={group.key}>
                <h3>{group.label}</h3>
                <div className={layout === "list" ? "r22-lib-list" : "r22-lib-grid"}>
                  {group.assets.map((asset) => (
                    <LibraryCard
                      key={asset.id}
                      asset={asset}
                      layout={layout}
                      selected={selected.includes(asset.id)}
                      selecting={selectedCount > 0}
                      onOpen={(row) => setDetailId(row.id)}
                      onSelect={onSelect}
                      onStar={(row) => patch([row.id], (item) => ({ ...item, starred: !item.starred }), row.starred ? `${row.name} is out of Starred.` : `${row.name} is in Starred.`)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <Empty className="r22-lib-empty">
            <EmptyHeader>
              <EmptyDescription>{emptyCopy}</EmptyDescription>
            </EmptyHeader>
            {emptyActions ? <EmptyContent>{emptyActions}</EmptyContent> : null}
          </Empty>
        )}
      </div>

      <LibraryQuickCreate open={createOpen} busy={running} onClose={() => setCreateOpen(false)} onRun={runQuickCreate} />

      {selectedCount ? (
        <div className="r22-lib-bulk" role="group" aria-label="Selected items">
          {/* 选中数是一枚芯片,不是一句住在批量条里的话(审计 B-4)。 */}
          <Badge className="r22-lib-bulk-count" data-r22-lib-selected={selectedCount}>{selectedCount} selected</Badge>
          <Button unstyled type="button" onClick={bulkStar}>Star</Button>
          <Button unstyled type="button" onClick={() => setPackTarget("selection")}>Add to pack</Button>
          <Button unstyled type="button" onClick={download}>Download</Button>
          {openPackId
            ? <Button unstyled type="button" onClick={removeFromPack}>Remove from pack</Button>
            : <Button unstyled type="button" onClick={removeSelected}>Remove</Button>}
          <Button unstyled type="button" className="r22-lib-bulk-x" onClick={() => setSelected([])}>Clear</Button>
        </div>
      ) : null}

      {detail ? (
        <LibraryDetailLayer
          asset={detail}
          fixture={fixture}
          onClose={() => setDetailId(null)}
          onStar={(row) => patch([row.id], (item) => ({ ...item, starred: !item.starred }), row.starred ? `${row.name} is out of Starred.` : `${row.name} is in Starred.`)}
          onDownload={download}
          onAddToPack={(row) => { setDetailId(null); setPackTarget(row.id); }}
          onEdit={(row) => { setDetailId(null); setEditId(row.id); }}
          onOpenSource={(id) => setDetailId(id)}
        />
      ) : null}

      {editing ? (
        <ImageEditLayer
          asset={editing}
          versions={editedVersionsOf(archive.assets, editing.id)}
          onClose={() => setEditId(null)}
          onMakeEdit={(change) => makeEdit(editing, change)}
        />
      ) : null}

      <LibraryPackDialog
        open={packTarget !== null}
        count={packDialogIds.length}
        packs={archive.packs}
        onClose={() => setPackTarget(null)}
        onAdd={addToPack}
        onCreate={createPack}
      />
    </div>
  );
}

export default LibraryWorkroom;
