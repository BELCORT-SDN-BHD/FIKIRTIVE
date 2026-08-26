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
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { scopedR22FixtureKey } from "@/components/r22/r22-workspace-fixture";
import {
  appendCanvasFixtureHandoff,
  FIXTURE_VIDEO_CONCEPT_SECONDS,
  fixtureBatchHome,
  fixtureQuoteCredits,
} from "@/components/canvas/r22-canvas-fixture";

import { LibraryCard } from "./LibraryCard";
import { LibraryDetailLayer } from "./LibraryDetailLayer";
import { LibraryNav } from "./LibraryNav";
import { LibraryPackDialog } from "./LibraryPackDialog";
import { LibraryQuickCreate, type QuickCreateRequest } from "./LibraryQuickCreate";
import { LibraryToolbar } from "./LibraryToolbar";
import {
  addLibraryAssets,
  attachToPack,
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
  const [packTarget, setPackTarget] = useState<"selection" | string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  /** `null` = 没在改名。空串是「改名中,但先清空了」—— 两件事不能共用一个假值。 */
  const [renaming, setRenaming] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  /** 生成条开着没有。它是页内浮层,不是路由 —— 关掉不该丢掉网格的滚动位置与多选态。 */
  const [createOpen, setCreateOpen] = useState(false);
  /** 这一次 Quick create 还在跑没有。跑着的时候发送键关着,一句话不该同时排两次。 */
  const [running, setRunning] = useState(false);
  /** 回执里那条「Continue in Canvas」指向哪块板。`null` = 这条回执没有后续动作。 */
  const [continueTo, setContinueTo] = useState<string | null>(null);
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

  /** 一次写入 = 一次落盘 + 一句人话。落不进去就照实说,不把改动留在屏幕上骗人。 */
  const commit = useCallback((next: LibraryArchive, message: string): boolean => {
    // 上一条回执的后续动作跟着上一条走 —— 新的一句话出来了,旧那颗按钮就不该还杵在那儿。
    setContinueTo(null);
    if (restore && !writeLibraryArchive(scopedR22FixtureKey(LIBRARY_FIXTURE_KEY), next)) {
      setNotice(NO_ROOM);
      return false;
    }
    setArchive(next);
    setNotice(message);
    return true;
  }, [restore]);

  /** 只说一句话,不动东西。 */
  const say = useCallback((message: string) => {
    setContinueTo(null);
    setNotice(message);
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
      // 详情层与两个弹层是 Radix 自己的地盘,那一记归它们,工作台不抢。
      if (detailId || packTarget || confirmRemove) return;
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
  }, [confirmRemove, createOpen, detailId, packTarget, selected.length]);

  /* ── 批量动作 ─────────────────────────────────────────────────────────────── */

  function bulkStar() {
    patch(selected, (asset) => ({ ...asset, starred: true }), `${countLabel(selectedCount)} starred.`);
  }

  function download() {
    say("Downloads are not switched on yet, so nothing was saved to your computer.");
  }

  function removeSelected() {
    setConfirmRemove(false);
    patch(selected, (asset) => ({ ...asset, hidden: true }), `${countLabel(selectedCount)} hidden from your Library, still on the canvas where they were made.`);
    setSelected([]);
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
      const landed = commit(
        // 读-改-写:合并的是**此刻**的存档,不是按下发送那一刻的旧快照。
        addLibraryAssets(archiveRef.current, made),
        request.kind === "video"
          ? `${countLabel(made.length)} in your Library. Video is a still stand-in, not a playable video — ${credits} cr.`
          : `${countLabel(made.length)} in your Library — ${credits} cr.`,
      );
      if (!landed) return;
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
      setContinueTo(QUICK_CREATE_PROJECT_ID);
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
          : "Nothing here yet. Make something on a canvas, or upload a picture of your own.";

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

        {notice ? (
          <p className="r22-lib-notice" role="status">
            <span>{notice}</span>
            {continueTo ? <Link className="r22-lib-notice-act" data-r22-lib-continue href={libraryCanvasHref(continueTo, fixture)}>Continue in Canvas</Link> : null}
          </p>
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
          <section className="r22-lib-empty">{emptyCopy}</section>
        )}
      </div>

      <LibraryQuickCreate open={createOpen} busy={running} onClose={() => setCreateOpen(false)} onRun={runQuickCreate} />

      {selectedCount ? (
        <div className="r22-lib-bulk" role="group" aria-label="Selected items">
          <b>{selectedCount} selected</b>
          <Button unstyled type="button" onClick={bulkStar}>Star</Button>
          <Button unstyled type="button" onClick={() => setPackTarget("selection")}>Add to pack</Button>
          <Button unstyled type="button" onClick={download}>Download</Button>
          {openPackId
            ? <Button unstyled type="button" onClick={removeFromPack}>Remove from pack</Button>
            : <Button unstyled type="button" onClick={() => setConfirmRemove(true)}>Remove</Button>}
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

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hide {countLabel(selectedCount)} from your Library?</AlertDialogTitle>
            <AlertDialogDescription>They stay on the canvas where they were made, so you can bring them back from there.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep them</AlertDialogCancel>
            <AlertDialogAction onClick={removeSelected}>Hide them</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default LibraryWorkroom;
