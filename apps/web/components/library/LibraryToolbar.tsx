"use client";

/**
 * LibraryToolbar.tsx —— 主区顶上那一排:搜索、类型、排序、视图、做点东西、上传。
 *
 * 这一排最右边现在是**两颗并列**的按钮,主次分明:
 *   · **Create** 是主按钮 —— 仓库里也能直接开工。商家站在自己的东西中间想再要一张,
 *     最短的路不是「回首页 → 进画布 → 选项目」,而是就地说一句话。
 *   · **Upload** 降为次级 —— 它照旧是一等公民(藏进菜单第三层等于告诉商家「你的照片不
 *     算数」),只是不再是这一排唯一的动作。
 *
 * 真的 file picker:`<Input type="file">` 藏在视觉之外(不是 `display:none` —— 那样键盘也
 * 到不了),按钮点它。
 */

import { LayoutGrid, Rows3, Search, Sparkles, Upload } from "lucide-react";
import { useRef, type ChangeEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import type { LibraryLayout, LibrarySort, LibraryTypeFilter } from "./library-fixture";

export function LibraryToolbar({
  query,
  type,
  sort,
  layout,
  fixture,
  createOpen,
  onQuery,
  onType,
  onSort,
  onLayout,
  onFiles,
  onCreate,
}: {
  query: string;
  type: LibraryTypeFilter;
  sort: LibrarySort;
  layout: LibraryLayout;
  fixture: boolean;
  createOpen: boolean;
  onQuery: (value: string) => void;
  onType: (value: LibraryTypeFilter) => void;
  onSort: (value: LibrarySort) => void;
  onLayout: (value: LibraryLayout) => void;
  onFiles: (files: FileList | null) => void;
  onCreate: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  function pick(event: ChangeEvent<HTMLInputElement>) {
    onFiles(event.target.files);
    event.target.value = "";
  }

  return (
    <div className="r22-lib-tools">
      <label className="r22-lib-search">
        <Search aria-hidden="true" />
        <Input unstyled type="search" aria-label="Search library" placeholder="Search Library" value={query} onChange={(event) => onQuery(event.target.value)} />
      </label>

      <ToggleGroup unstyled className="r22-lib-seg" type="single" value={type} aria-label="Type" onValueChange={(value) => { if (value) onType(value as LibraryTypeFilter); }}>
        <ToggleGroupItem unstyled value="all">All</ToggleGroupItem>
        <ToggleGroupItem unstyled value="image">Images</ToggleGroupItem>
        <ToggleGroupItem unstyled value="video">Videos</ToggleGroupItem>
      </ToggleGroup>

      <ToggleGroup unstyled className="r22-lib-seg" type="single" value={sort} aria-label="Sort" onValueChange={(value) => { if (value) onSort(value as LibrarySort); }}>
        <ToggleGroupItem unstyled value="newest">Newest</ToggleGroupItem>
        <ToggleGroupItem unstyled value="oldest">Oldest</ToggleGroupItem>
      </ToggleGroup>

      <ToggleGroup unstyled className="r22-lib-seg r22-lib-seg-icon" type="single" value={layout} aria-label="View" onValueChange={(value) => { if (value) onLayout(value as LibraryLayout); }}>
        <ToggleGroupItem unstyled value="grid" aria-label="Grid view"><LayoutGrid aria-hidden="true" /></ToggleGroupItem>
        <ToggleGroupItem unstyled value="list" aria-label="List view"><Rows3 aria-hidden="true" /></ToggleGroupItem>
      </ToggleGroup>

      {fixture ? <span className="r22-lib-sample">Prototype · sample data</span> : null}

      <Button unstyled type="button" className="r22-lib-create" data-r22-lib-create aria-expanded={createOpen} onClick={onCreate}><Sparkles aria-hidden="true" />Create</Button>
      <Button unstyled type="button" className="r22-lib-upload" onClick={() => fileRef.current?.click()}><Upload aria-hidden="true" />Upload</Button>
      <Input ref={fileRef} unstyled className="r22-lib-file" type="file" accept="image/*" aria-label="Upload a picture" onChange={pick} />
    </div>
  );
}

export default LibraryToolbar;
