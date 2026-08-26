"use client";

/**
 * LibraryToolbar.tsx —— 主区顶上那一排:搜索、类型、排序、视图、做点东西、上传。
 *
 * 这一排最右边是三颗,主次分明:
 *   · **Create** 是主按钮 —— 按下去开的是那块**全屏创作对话**(左产物、右线程,
 *     Founder 2026-08-26 第 1 件)。仓库里也能直接开工,而且开的是能一直做下去的那块地方,
 *     不是一条说完就收的输入条。
 *   · **Quick create** 是轻入口 —— 页内那条一行生成条原样留着。商家心里已经有确切的一句
 *     话、只想再要一张的时候,开一整块全屏是把他从他正在整理的那一屏拽走。两条路做的
 *     是同一件事的两种规模,不是两套实现:价目、模板、落库都是同一份。
 *   · **Upload** 照旧是一等公民(藏进菜单第三层等于告诉商家「你的照片不算数」)。
 *
 * 真的 file picker:一个 type=file 的 Input 藏在视觉之外(不是 `display:none` —— 那样键盘
 * 也到不了),按钮点它。
 */

import { LayoutGrid, Rows3, Search, Sparkles, Upload } from "lucide-react";
import { useRef, type ChangeEvent, type RefObject } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
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
  onQuickCreate,
  fileRef: sharedFileRef,
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
  /** 主路径:开那块全屏创作对话(Founder 2026-08-26 第 1 件)。 */
  onCreate: () => void;
  /** 轻入口:页内那条一行生成条,原样留着 —— 见文件顶部那段分工。 */
  onQuickCreate: () => void;
  /** 工作台把这个 ref 借走,好让空态里那颗 Upload 按的是**同一个** input(审计 B-6)。 */
  fileRef?: RefObject<HTMLInputElement | null>;
}) {
  const ownFileRef = useRef<HTMLInputElement>(null);
  const fileRef = sharedFileRef ?? ownFileRef;

  function pick(event: ChangeEvent<HTMLInputElement>) {
    onFiles(event.target.files);
    event.target.value = "";
  }

  return (
    <div className="r22-lib-tools">
      {/* 搜索框归 `ui/input-group`(审计 A-12):图标不再靠 `position:absolute` 摆位,
          focus 环由正典件统一出 —— 五处搜索框此前各写各的。 */}
      <InputGroup className="r22-lib-search">
        <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
        <InputGroupInput type="search" aria-label="Search library" placeholder="Search Library" value={query} onChange={(event) => onQuery(event.target.value)} />
      </InputGroup>

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

      <Button unstyled type="button" className="r22-lib-quick" data-r22-lib-quick aria-expanded={createOpen} onClick={onQuickCreate}>Quick create</Button>
      <Button unstyled type="button" className="r22-lib-create" data-r22-lib-create onClick={onCreate}><Sparkles aria-hidden="true" />Create</Button>
      <Button unstyled type="button" className="r22-lib-upload" onClick={() => fileRef.current?.click()}><Upload aria-hidden="true" />Upload</Button>
      <Input ref={fileRef} unstyled className="r22-lib-file" type="file" accept="image/*" aria-label="Upload a picture" onChange={pick} />
    </div>
  );
}

export default LibraryToolbar;
