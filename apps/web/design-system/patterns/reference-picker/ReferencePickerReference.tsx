"use client"

import Image from "next/image"
import Link from "next/link"
import * as React from "react"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ImageIcon,
  ImagesIcon,
  MapPinIcon,
  PackageIcon,
  PlusIcon,
  ShirtIcon,
  SparklesIcon,
  UploadIcon,
  UserRoundIcon,
  UsersRoundIcon,
  XIcon,
} from "lucide-react"

import { OttoAvatar } from "@/design-system/brand/components/OttoAvatar"
import { Button, buttonVariants } from "@/design-system/primitives/button"
import { InputGroup, InputGroupButton, InputGroupTextarea } from "@/design-system/primitives/input-group"
import { activeMentionQuery } from "@/lib/otto-mentions"
import { cn } from "@/lib/utils"

import { RECENT_REFERENCE_IDS, REFERENCE_FIXTURES } from "./fixtures"
import {
  REFERENCE_PICKER_STATES,
  type ReferenceItem,
  type ReferencePickerState,
  type ReferenceType,
} from "./model"

type Category = {
  label: string
  types: readonly ReferenceType[]
  icon: React.ComponentType<{ className?: string }>
}

type MenuEntry =
  | { kind: "item"; item: ReferenceItem }
  | { kind: "category"; category: Category }

const CATEGORIES: readonly Category[] = [
  { label: "Products", types: ["product"], icon: PackageIcon },
  { label: "Characters", types: ["character"], icon: UsersRoundIcon },
  { label: "Official avatars", types: ["official-avatar"], icon: UserRoundIcon },
  { label: "Locations", types: ["location"], icon: MapPinIcon },
  { label: "Clothes", types: ["clothes"], icon: ShirtIcon },
  { label: "Media", types: ["generation", "upload"], icon: ImagesIcon },
]

const STATE_SETUP: Record<ReferencePickerState, { text: string; open: boolean }> = {
  recent: { text: "@", open: true },
  search: { text: "@al", open: true },
  category: { text: "@", open: true },
  selected: { text: "Create a warm product image with these references", open: false },
  empty: { text: "@zzzz", open: true },
  unavailable: { text: "@night", open: true },
}

const PRESET_SELECTED = REFERENCE_FIXTURES.filter((item) => ["actor-alya", "product-jasmine"].includes(item.id))

function ReferenceTypeIcon({ type, className }: { type: ReferenceType; className?: string }) {
  switch (type) {
    case "product": return <PackageIcon className={className} />
    case "character": return <UsersRoundIcon className={className} />
    case "official-avatar": return <UserRoundIcon className={className} />
    case "location": return <MapPinIcon className={className} />
    case "clothes": return <ShirtIcon className={className} />
    case "generation": return <SparklesIcon className={className} />
    case "upload": return <UploadIcon className={className} />
  }
}

function ReferenceThumb({ item }: { item: ReferenceItem }) {
  return item.image ? (
    <span className="relative size-9 shrink-0 overflow-hidden rounded-[var(--radius)] border border-border bg-muted">
      <Image alt="" fill sizes="36px" src={item.image} className="object-cover" />
    </span>
  ) : (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius)] border border-border bg-muted">
      <ReferenceTypeIcon className="size-4 text-muted-foreground" type={item.type} />
    </span>
  )
}

function MentionToken({ item, onRemove }: { item: ReferenceItem; onRemove?: () => void }) {
  return (
    <span className="inline-flex max-w-56 items-center gap-1.5 rounded-full border border-border bg-muted px-2 py-1 text-xs font-medium text-foreground">
      <ReferenceTypeIcon className="size-3.5 shrink-0 text-muted-foreground" type={item.type} />
      <span className="truncate">@{item.name}</span>
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove ${item.name}`}
          className="-mr-1 flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onRemove}
        >
          <XIcon className="size-3" />
        </button>
      ) : null}
    </span>
  )
}

export function ReferencePickerReference({ initialState = "recent" }: { initialState?: ReferencePickerState }) {
  const [state, setState] = React.useState<ReferencePickerState>(initialState)
  const [text, setText] = React.useState(STATE_SETUP[initialState].text)
  const [open, setOpen] = React.useState(STATE_SETUP[initialState].open)
  const [category, setCategory] = React.useState<Category>(CATEGORIES[2])
  const [selected, setSelected] = React.useState<ReferenceItem[]>(
    initialState === "selected" ? PRESET_SELECTED : [],
  )
  const [highlightedIndex, setHighlightedIndex] = React.useState(0)
  const [sentMessage, setSentMessage] = React.useState<{ text: string; items: ReferenceItem[] } | null>(
    initialState === "selected" ? { text: STATE_SETUP.selected.text, items: PRESET_SELECTED } : null,
  )
  const [caret, setCaret] = React.useState(STATE_SETUP[initialState].text.length)
  const [focusPosition, setFocusPosition] = React.useState<number | null>(null)
  const inputRef = React.useRef<HTMLTextAreaElement>(null)
  const uploadRef = React.useRef<HTMLInputElement>(null)
  const listId = React.useId()

  const recent = RECENT_REFERENCE_IDS.flatMap((id) => REFERENCE_FIXTURES.filter((item) => item.id === id))
  const mention = activeMentionQuery(text, caret)
  const query = mention?.toLowerCase() ?? ""

  const visibleItems = React.useMemo(() => {
    if (state === "unavailable") return REFERENCE_FIXTURES.filter((item) => item.unavailableReason)
    if (state === "category") return REFERENCE_FIXTURES.filter((item) => category.types.includes(item.type))
    if (state === "recent" && query === "") return recent
    if (state === "empty") return []
    return REFERENCE_FIXTURES.filter((item) => item.name.toLowerCase().includes(query)).slice(0, 8)
  }, [category, query, recent, state])

  const menuEntries = React.useMemo<readonly MenuEntry[]>(() => {
    const itemEntries = visibleItems.map((item) => ({ kind: "item" as const, item }))
    return state === "recent" && query === ""
      ? [...itemEntries, ...CATEGORIES.map((category) => ({ kind: "category" as const, category }))]
      : itemEntries
  }, [query, state, visibleItems])

  React.useLayoutEffect(() => {
    if (focusPosition === null || !inputRef.current) return
    inputRef.current.focus()
    inputRef.current.setSelectionRange(focusPosition, focusPosition)
    setFocusPosition(null)
  }, [focusPosition])

  React.useLayoutEffect(() => {
    const entry = menuEntries[highlightedIndex]
    if (!open || !entry || (entry.kind === "item" && entry.item.unavailableReason)) return
    document.getElementById(`${listId}-option-${highlightedIndex}`)?.scrollIntoView?.({
      behavior: "instant" as ScrollBehavior,
      block: "nearest",
    })
  }, [highlightedIndex, listId, menuEntries, open])

  function focusComposer(position = caret) {
    setFocusPosition(position)
  }

  function setSentReferenceMessage() {
    setSentMessage({
      text: text.trim() || "Use these references in the next creation.",
      items: selected.map((item) => ({ ...item })),
    })
    setOpen(false)
  }

  function applyState(next: ReferencePickerState) {
    const setup = STATE_SETUP[next]
    setState(next)
    setText(setup.text)
    setOpen(setup.open)
    setCaret(setup.text.length)
    setCategory(CATEGORIES[2])
    setSelected(next === "selected" ? PRESET_SELECTED : [])
    setSentMessage(next === "selected" ? { text: setup.text, items: PRESET_SELECTED.map((item) => ({ ...item })) } : null)
    setHighlightedIndex(0)
    focusComposer(setup.text.length)
  }

  function selectItem(item: ReferenceItem) {
    if (item.unavailableReason) return
    const textareaPosition = inputRef.current?.selectionStart ?? caret
    const position = activeMentionQuery(text, textareaPosition) === null ? caret : textareaPosition
    const activeQuery = activeMentionQuery(text, position)
    if (activeQuery === null) return
    const mentionStart = position - activeQuery.length - 1
    setSelected((current) => current.some((selectedItem) => selectedItem.id === item.id) ? current : [...current, item])
    setText((current) => current.slice(0, mentionStart) + current.slice(position))
    setCaret(mentionStart)
    setOpen(false)
    setHighlightedIndex(0)
    focusComposer(mentionStart)
  }

  function selectCategory(next: Category) {
    setCategory(next)
    setState("category")
    setOpen(true)
    setHighlightedIndex(0)
    focusComposer()
  }

  function returnToRecent() {
    setState("recent")
    setOpen(true)
    setHighlightedIndex(0)
    focusComposer()
  }

  function updateMentionState(value: string, position: number) {
    setCaret(position)
    const nextQuery = activeMentionQuery(value, position)
    if (nextQuery === null) {
      setOpen(false)
      return
    }
    setState(nextQuery ? (nextQuery.toLowerCase() === "zzzz" ? "empty" : nextQuery.toLowerCase() === "night" ? "unavailable" : "search") : "recent")
    setOpen(true)
    setHighlightedIndex(0)
  }

  function handleTextChange(value: string, position: number) {
    setText(value)
    updateMentionState(value, position)
  }

  function moveHighlight(direction: 1 | -1) {
    if (!menuEntries.length) return
    let next = highlightedIndex
    for (let attempt = 0; attempt < menuEntries.length; attempt += 1) {
      next = (next + direction + menuEntries.length) % menuEntries.length
      const entry = menuEntries[next]
      if (entry?.kind === "category" || !entry?.item.unavailableReason) break
    }
    setHighlightedIndex(next)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing || event.key === "Process") return
    if (event.key === "Enter" && event.shiftKey) {
      if (text.trim() || selected.length) {
        event.preventDefault()
        setSentReferenceMessage()
      }
      return
    }
    if (open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        moveHighlight(event.key === "ArrowDown" ? 1 : -1)
        return
      }
      if ((event.key === "Enter" && !event.shiftKey) || (event.key === "Tab" && !event.shiftKey)) {
        const entry = menuEntries[highlightedIndex]
        if (entry?.kind === "item" && !entry.item.unavailableReason) {
          event.preventDefault()
          selectItem(entry.item)
          return
        }
        if (entry?.kind === "category") {
          event.preventDefault()
          selectCategory(entry.category)
          return
        }
      }
      if (event.key === "Escape") {
        event.preventDefault()
        setOpen(false)
        return
      }
    }
  }

  return (
    <main className="gb flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex min-h-14 flex-wrap items-center gap-3 border-b border-border px-4 py-2">
        <div className="mr-auto flex min-w-0 items-center gap-2">
          <Button aria-label="Back to Canvas" asChild motion="instant" size="icon-sm" variant="ghost">
            <Link href="/product-patterns/canvas"><ChevronLeftIcon /></Link>
          </Button>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">Otto Reference picker</p>
            <p className="truncate text-xs text-muted-foreground">Review fixture · No production data</p>
          </div>
        </div>
        <nav aria-label="Reference picker states" className="flex flex-wrap items-center gap-1 rounded-[var(--radius-card)] bg-muted p-1">
          {REFERENCE_PICKER_STATES.map((item) => (
            <Button
              key={item.value}
              aria-current={state === item.value ? "page" : undefined}
              motion="instant"
              size="sm"
              variant={state === item.value ? "secondary" : "ghost"}
              onClick={() => applyState(item.value)}
            >
              {item.label}
            </Button>
          ))}
        </nav>
      </header>

      <section className="relative min-h-[calc(100vh-3.5rem)] flex-1 overflow-hidden bg-[radial-gradient(circle,var(--border)_1px,transparent_1px)] [background-size:24px_24px]">
        <div className="absolute left-5 top-5 w-72 rounded-[var(--radius-card)] border border-border bg-card shadow-[var(--shadow-sm)]">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2.5 text-xs font-semibold">
            <OttoAvatar size={22} />
            Otto
            <span className="ml-auto flex items-center gap-1.5 font-normal text-muted-foreground"><span className="size-1.5 rounded-full bg-success" />Ready</span>
          </div>
          <p className="px-3 py-3 text-sm leading-5">Reference the exact people, products or media Otto should use.</p>
        </div>

        {sentMessage ? (
          <div className="absolute left-1/2 top-[18%] w-[min(620px,calc(100%-3rem))] -translate-x-1/2 rounded-[var(--radius-card)] border border-border bg-card p-4 shadow-[var(--shadow-sm)]">
            <div className="mb-3 flex flex-wrap gap-1.5">
              {sentMessage.items.map((item) => <MentionToken item={item} key={item.id} />)}
            </div>
            <p className="text-sm leading-6">{sentMessage.text}</p>
            <p className="mt-3 text-xs text-muted-foreground">References remain visible in conversation and generation history.</p>
          </div>
        ) : null}

        <div className="absolute bottom-5 left-1/2 w-[min(680px,calc(100%-3rem))] -translate-x-1/2">
          {open ? (
            <div className="mb-2 overflow-hidden rounded-[var(--radius-card)] border border-border bg-popover shadow-[var(--shadow-md)]">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <div>
                  <p className="text-xs font-semibold">{state === "category" ? category.label : state === "recent" ? "Recent" : "References"}</p>
                  <p className="text-xs text-muted-foreground">{state === "recent" ? "Recently used in your workspace" : state === "category" ? "Choose one exact object" : `Results for “${query}”`}</p>
                </div>
                {state === "category" ? (
                  <Button motion="instant" size="sm" variant="ghost" onClick={returnToRecent}><ChevronLeftIcon />All types</Button>
                ) : null}
              </div>

              {visibleItems.length ? (
                <div id={listId} role="listbox" aria-label="References">
                  <div className="max-h-[352px] overflow-y-auto p-1">
                    {visibleItems.map((item, index) => {
                    const unavailable = Boolean(item.unavailableReason)
                    return (
                      <button
                        key={item.id}
                        id={`${listId}-option-${index}`}
                        type="button"
                        role="option"
                        aria-selected={!unavailable && index === highlightedIndex}
                        aria-disabled={unavailable}
                        disabled={unavailable}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-[var(--radius)] px-2.5 py-2 text-left outline-none",
                          index === highlightedIndex && "bg-accent text-accent-foreground",
                          unavailable && "cursor-not-allowed opacity-55",
                          !unavailable && "hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                        )}
                        onPointerMove={() => !unavailable && setHighlightedIndex(index)}
                        onClick={() => selectItem(item)}
                      >
                        <ReferenceThumb item={item} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{item.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">{item.unavailableReason ?? item.meta}</span>
                        </span>
                        <ReferenceTypeIcon className="size-4 shrink-0 text-muted-foreground" type={item.type} />
                      </button>
                      )
                    })}
                  </div>

                  {state === "recent" ? (
                    <div className="border-t border-border p-1">
                      <p className="px-2.5 pb-1 pt-2 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Browse by type</p>
                      <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                        {CATEGORIES.map((item, categoryIndex) => {
                          const Icon = item.icon
                          const index = visibleItems.length + categoryIndex
                          return (
                            <button
                              key={item.label}
                              id={`${listId}-option-${index}`}
                              type="button"
                              role="option"
                              aria-selected={index === highlightedIndex}
                              className={cn(
                                "flex items-center gap-2 rounded-[var(--radius)] px-2.5 py-2 text-left text-xs font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                                index === highlightedIndex && "bg-accent text-accent-foreground",
                              )}
                              onPointerMove={() => setHighlightedIndex(index)}
                              onClick={() => selectCategory(item)}
                            >
                              <Icon className="size-4 text-muted-foreground" />
                              <span className="truncate">{item.label}</span>
                              <ChevronRightIcon className="ml-auto size-3.5 text-muted-foreground" />
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="p-5 text-center">
                  <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-muted"><ImageIcon className="size-4 text-muted-foreground" /></div>
                  <p className="text-sm font-semibold">No references found</p>
                  <p className="mt-1 text-xs text-muted-foreground">Try another name, upload media or browse Library.</p>
                  <div className="mt-4 flex justify-center gap-2">
                    <Button motion="instant" size="sm" variant="outline" onClick={() => uploadRef.current?.click()}><UploadIcon />Upload media</Button>
                    <Link className={buttonVariants({ size: "sm" })} href="/product-patterns/library">Browse Library</Link>
                  </div>
                </div>
              )}

            </div>
          ) : null}

          <InputGroup className="flex-col items-stretch rounded-[var(--radius-card)] bg-background p-2 shadow-[var(--shadow-md)]">
            {selected.length ? (
              <div className="flex flex-wrap gap-1.5 px-1 pb-1">
                {selected.map((item) => (
                  <MentionToken key={item.id} item={item} onRemove={() => setSelected((current) => current.filter((selectedItem) => selectedItem.id !== item.id))} />
                ))}
              </div>
            ) : null}
            <InputGroupTextarea
              ref={inputRef}
              aria-label="Ask Otto"
              aria-autocomplete="list"
              aria-controls={open && visibleItems.length ? listId : undefined}
              aria-expanded={open}
              aria-activedescendant={open && menuEntries[highlightedIndex] && (menuEntries[highlightedIndex]?.kind === "category" || !menuEntries[highlightedIndex]?.item.unavailableReason) ? `${listId}-option-${highlightedIndex}` : undefined}
              className="min-h-[72px] w-full px-2.5 py-2 text-base leading-6"
              placeholder="Describe what you want to create. Type @ to reference something."
              value={text}
              onChange={(event) => handleTextChange(event.target.value, event.target.selectionStart ?? event.target.value.length)}
              onSelect={(event) => {
                const position = event.currentTarget.selectionStart ?? event.currentTarget.value.length
                if (position === caret && event.currentTarget.value === text) return
                updateMentionState(event.currentTarget.value, position)
              }}
              onKeyDown={handleKeyDown}
            />
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <InputGroupButton aria-label="Add context" size="icon-sm" onClick={() => uploadRef.current?.click()}><PlusIcon /></InputGroupButton>
                <span className="text-xs text-muted-foreground">Type @ to reference</span>
              </div>
              <Button
                aria-label="Send to Otto"
                disabled={!text.trim() && !selected.length}
                motion="instant"
                size="icon-sm"
                variant="otto"
                onClick={() => {
                  setSentReferenceMessage()
                }}
              >
                <SparklesIcon />
              </Button>
            </div>
          </InputGroup>
          <input
            ref={uploadRef}
            hidden
            type="file"
            accept="image/*,video/*"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (!file) return
              const uploaded: ReferenceItem = { id: `review-${file.name}`, name: file.name, type: "upload", meta: "Upload · Review fixture" }
              setSelected((current) => current.some((item) => item.id === uploaded.id) ? current : [...current, uploaded])
              setText((current) => current || "Use the uploaded media as a reference")
              setOpen(false)
            }}
          />
        </div>
      </section>
    </main>
  )
}
