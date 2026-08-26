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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { scopedR22FixtureKey } from "@/components/r22/r22-workspace-fixture";

import { LibraryCard } from "./LibraryCard";
import { LibraryDetailLayer } from "./LibraryDetailLayer";
import { LibraryNav } from "./LibraryNav";
import { LibraryPackDialog } from "./LibraryPackDialog";
import { LibraryToolbar } from "./LibraryToolbar";
import {
  groupLibraryByDay,
  LIBRARY_FIXTURE_KEY,
  packIdOf,
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
  const anchorRef = useRef<string | null>(null);

  useEffect(() => {
    if (!restore) return;
    setArchive(readLibraryArchive(scopedR22FixtureKey(LIBRARY_FIXTURE_KEY)));
    setRestored(true);
  }, [restore]);

  /** 一次写入 = 一次落盘 + 一句人话。落不进去就照实说,不把改动留在屏幕上骗人。 */
  const commit = useCallback((next: LibraryArchive, message: string): boolean => {
    if (restore && !writeLibraryArchive(scopedR22FixtureKey(LIBRARY_FIXTURE_KEY), next)) {
      setNotice(NO_ROOM);
      return false;
    }
    setArchive(next);
    setNotice(message);
    return true;
  }, [restore]);

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
    uploads: live.filter((asset) => asset.source === "uploaded").length,
  }), [live]);
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
      if (!selected.length) return;
      event.preventDefault();
      setSelected([]);
      anchorRef.current = null;
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmRemove, detailId, packTarget, selected.length]);

  /* ── 批量动作 ─────────────────────────────────────────────────────────────── */

  function bulkStar() {
    patch(selected, (asset) => ({ ...asset, starred: true }), `${countLabel(selectedCount)} starred.`);
  }

  function download() {
    setNotice("Downloads are not switched on yet, so nothing was saved to your computer.");
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
    patch(packDialogIds, (asset) => (asset.packIds.includes(packId) ? asset : { ...asset, packIds: [...asset.packIds, packId] }), `${countLabel(packDialogIds.length)} in ${name}.`);
    setPackTarget(null);
  }

  function createPack(name: string) {
    const id = `pack-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || archive.packs.length + 1}`;
    const wanted = new Set(packDialogIds);
    commit({
      packs: [...archive.packs, { id, name }],
      assets: archive.assets.map((asset) => (wanted.has(asset.id) ? { ...asset, packIds: [...asset.packIds, id] } : asset)),
    }, `${countLabel(packDialogIds.length)} in ${name}.`);
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
    if (!file.type.startsWith("image/")) return setNotice("Only pictures can be added here, so that file was not added.");
    if (file.size > UPLOAD_BUDGET_BYTES) {
      return setNotice(`${uploadDisplayName(file.name)} is larger than ${UPLOAD_BUDGET_LABEL}, so it was not added. Pick a smaller picture and it will show up here.`);
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
    reader.onerror = () => setNotice(`${uploadDisplayName(file.name)} could not be read, so it was not added.`);
    reader.readAsDataURL(file);
  }

  /* ── 画 ───────────────────────────────────────────────────────────────────── */

  if (restore && !restored) return <section className="r22-lib-wait" aria-busy="true">Opening your Library…</section>;

  const emptyCopy = query.trim()
    ? `Nothing here matches “${query.trim()}”.`
    : section === "uploads"
      ? "No pictures of your own yet. Use Upload and they will sit here beside everything Otto made."
      : section === "starred"
        ? "Nothing starred yet. Star the keepers and they gather here."
        : "Nothing here yet. Make something on a canvas, or upload a picture of your own.";

  return (
    <div className="r22-lib" data-layout={layout}>
      <LibraryNav
        section={section}
        counts={counts}
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
          onQuery={setQuery}
          onType={setType}
          onSort={setSort}
          onLayout={setLayout}
          onFiles={upload}
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

        {notice ? <p className="r22-lib-notice" role="status">{notice}</p> : null}

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
