"use client";

/**
 * MentionField.tsx —— composer 里的 `@`:打一个 @,候选浮出来,选中变成一枚引用芯片。
 *
 * Founder 2026-08-26 深夜第 3 件。为什么它必须是共用的一份:面板 composer 的占位句从
 * R22 原型起就写着 "Ask Otto — @ adds references" —— 一句承诺挂了几个月,而打下去什么都
 * 不会发生。承诺与实现分家的修法不是把承诺删掉,是把实现补上,并且**只补一次**:画布、
 * 面板、全屏创作对话三处 composer 引用同一份,于是「@ 能拉什么进来」在三处是同一件事。
 *
 * 反过来也写死在这里:**没接的面不许承诺**。这一份不装点缀 —— 宿主接了它,占位句才配写
 * @;宿主没接,占位句里就不许出现 @。
 *
 * 解析归 `lib/otto-mentions.ts`(`activeMentionQuery` / `resolveSentEntityIds`)——那两个
 * 纯函数早就在,真接后端的那条路也用它们。这一份只做界面:候选怎么排、键盘怎么走、
 * 选中之后 composer 里长什么样。
 *
 * 芯片与画布既有的「Image 1」上下文芯片同族(同一排、同一个圆角、同一颗叉),因为它们
 * 回答的是同一个问题:**我这句话在说谁**。
 */

import * as React from "react";
import { AtSign, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import "./r22-conversation.css";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { activeMentionQuery, resolveSentEntityIds } from "@/lib/otto-mentions";

/** 一个可以被 @ 到的东西。`group` 是候选表里的小节头(Library / Projects / Otto IQ)。 */
export type MentionCandidate = { id: string; name: string; group: string; hint?: string };

/**
 * 候选表:按商家已经打出来的那几个字滤一遍。
 *
 * 空 query 就是「刚打下 @,还没打字」——那时给的是全表,不是空表:商家打 @ 的目的常常
 * 就是「我想不起来它叫什么,给我看看有什么」。
 */
export function filterMentionCandidates(all: readonly MentionCandidate[], query: string): MentionCandidate[] {
  const term = query.trim().toLowerCase();
  if (!term) return [...all];
  return all.filter((candidate) => candidate.name.toLowerCase().includes(term));
}

/** 候选表按 group 归堆,顺序照传进来的那一份 —— 不重排,不去猜哪一类更重要。 */
export function groupMentionCandidates(items: readonly MentionCandidate[]): Array<{ group: string; items: MentionCandidate[] }> {
  const out: Array<{ group: string; items: MentionCandidate[] }> = [];
  for (const item of items) {
    const bucket = out.find((row) => row.group === item.group);
    if (bucket) bucket.items.push(item);
    else out.push({ group: item.group, items: [item] });
  }
  return out;
}

/**
 * 把 composer 里那一段 `@que` 换成 `@Full name `。
 *
 * 返回新文本与新的光标位置 —— 少还回光标,商家选完一个引用之后光标会跳到句末,接着打字
 * 就打在别人的话中间。
 */
export function applyMentionPick(text: string, caret: number, name: string): { text: string; caret: number } {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at === -1) return { text, caret };
  const head = `${text.slice(0, at)}@${name} `;
  return { text: `${head}${text.slice(caret)}`, caret: head.length };
}

export type MentionField = {
  /** 候选浮层开着没有。 */
  open: boolean;
  /** 此刻滤出来的候选(已经按 group 归好堆)。 */
  groups: Array<{ group: string; items: MentionCandidate[] }>;
  /** 平铺的候选(键盘上下走的就是这一条)。 */
  items: MentionCandidate[];
  activeIndex: number;
  /** 商家已经选中、并且此刻仍然留在句子里的那几个引用。 */
  chips: MentionCandidate[];
  /** composer 每次改字都叫一次:文字与光标都给,`@` 的判断只在这一处。 */
  sync: (text: string, caret: number | null) => void;
  /** 选中一个候选。文本与光标由它写回去。 */
  pick: (candidate: MentionCandidate) => void;
  /** 拔掉一枚芯片 —— 同时把句子里那一段 `@Name` 一起拿走,两边不许各说各的。 */
  drop: (id: string) => void;
  /** 浮层开着时先给它一次机会吃键(上下、Enter、Esc)。吃掉了返回 true。 */
  onKeyDown: (event: React.KeyboardEvent) => boolean;
  /** 这一句话发出去时真正挂着的那几个引用(句子里已经被删掉的不算)。 */
  sent: (text: string) => MentionCandidate[];
  /** 发送之后清干净。 */
  reset: () => void;
};

/**
 * composer 的 `@` 这件事的全部状态。
 *
 * 宿主给三样东西:候选表、此刻的文本与它的 setter、以及那个输入框的 ref(选中之后要把
 * 光标放回去,并且把焦点还给它 —— 浮层不抢焦点,商家可以一路打字一路选)。
 */
export function useMentionField({
  candidates,
  text,
  setText,
  inputRef,
}: {
  candidates: readonly MentionCandidate[];
  text: string;
  setText: (next: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
}): MentionField {
  const [query, setQuery] = React.useState<string | null>(null);
  const [caret, setCaret] = React.useState(0);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [picked, setPicked] = React.useState<MentionCandidate[]>([]);

  const items = React.useMemo(
    () => (query === null ? [] : filterMentionCandidates(candidates, query)),
    [candidates, query],
  );
  const open = query !== null && items.length > 0;

  const sync = React.useCallback((next: string, at: number | null) => {
    const position = at ?? next.length;
    setCaret(position);
    setQuery(activeMentionQuery(next, position));
    setActiveIndex(0);
  }, []);

  const pick = React.useCallback((candidate: MentionCandidate) => {
    const next = applyMentionPick(text, caret, candidate.name);
    setText(next.text);
    setPicked((current) => (current.some((row) => row.id === candidate.id) ? current : [...current, candidate]));
    setQuery(null);
    setActiveIndex(0);
    // 光标回到刚插进去那一段的后面,焦点还给输入框 —— 选完一个引用,商家接着说的是同一句话。
    window.requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(next.caret, next.caret);
    });
  }, [caret, inputRef, setText, text]);

  const drop = React.useCallback((id: string) => {
    const target = picked.find((row) => row.id === id);
    setPicked((current) => current.filter((row) => row.id !== id));
    // 芯片是句子里那一段 `@Name` 的镜子。只摘芯片、留着字,发出去的仍然带着这个引用 ——
    // 屏幕上说「已经拿掉了」,请求里没拿掉,这是这一件最容易犯的一种谎。
    if (target) {
      const escaped = target.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      setText(text.replace(new RegExp(`@${escaped}(?![\\w])\\s?`, "i"), ""));
    }
  }, [picked, setText, text]);

  const onKeyDown = React.useCallback((event: React.KeyboardEvent): boolean => {
    if (!open) return false;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % items.length);
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + items.length) % items.length);
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      const candidate = items[activeIndex];
      if (!candidate) return false;
      event.preventDefault();
      pick(candidate);
      return true;
    }
    if (event.key === "Escape") {
      // 这一记归浮层,不往上传 —— 上一层(弹窗 / 画布)的 Esc 链看的就是 `defaultPrevented`。
      event.preventDefault();
      setQuery(null);
      return true;
    }
    return false;
  }, [activeIndex, items, open, pick]);

  const chips = React.useMemo(() => {
    const live = new Set(resolveSentEntityIds(text, picked));
    return picked.filter((row) => live.has(row.id));
  }, [picked, text]);

  const sent = React.useCallback((value: string) => {
    const live = new Set(resolveSentEntityIds(value, picked));
    return picked.filter((row) => live.has(row.id));
  }, [picked]);

  const reset = React.useCallback(() => {
    setPicked([]);
    setQuery(null);
    setActiveIndex(0);
  }, []);

  return { open, groups: groupMentionCandidates(items), items, activeIndex, chips, sync, pick, drop, onKeyDown, sent, reset };
}

/**
 * 候选浮层。
 *
 * 它**不抢焦点**(`onOpenAutoFocus` 拦下来):商家一边打字一边看候选缩小,焦点一旦跳去
 * 浮层,他下一个字就打不进 composer 了。上下键与 Enter 因此由输入框那一头转过来
 * (`field.onKeyDown`),不是两套键盘各走各的。
 */
export function MentionPicker({ field, children }: { field: MentionField; children: React.ReactNode }) {
  const active = field.items[field.activeIndex];
  return (
    <Popover open={field.open}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent
        className="r22-mention-popover"
        align="start"
        side="top"
        sideOffset={8}
        data-otto-mention-popover=""
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <Command shouldFilter={false} value={active?.id ?? ""}>
          <CommandList>
            <CommandEmpty>Nothing here by that name.</CommandEmpty>
            {field.groups.map((group) => (
              <CommandGroup key={group.group} heading={group.group}>
                {group.items.map((candidate) => (
                  <CommandItem
                    key={candidate.id}
                    value={candidate.id}
                    data-otto-mention-option={candidate.id}
                    onSelect={() => field.pick(candidate)}
                  >
                    <AtSign aria-hidden />
                    <span>{candidate.name}</span>
                    {candidate.hint ? <small>{candidate.hint}</small> : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** 已经挂在这句话上的那几个引用。与画布的上下文芯片同族 —— 同一排、同一颗叉。 */
export function MentionChips({ field, className }: { field: MentionField; className?: string }) {
  if (!field.chips.length) return null;
  return (
    <>
      {field.chips.map((chip) => (
        <span className={`r22-mention-chip${className ? ` ${className}` : ""}`} key={chip.id} data-otto-mention-chip={chip.id}>
          <b>{chip.name}</b>
          <Button unstyled type="button" aria-label={`Remove ${chip.name} from this request`} data-otto-mention-chip-remove={chip.id} onClick={() => field.drop(chip.id)}>
            <X aria-hidden="true" />
          </Button>
        </span>
      ))}
    </>
  );
}
