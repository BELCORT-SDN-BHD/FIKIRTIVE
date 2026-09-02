"use client"

import * as React from "react"
import {
  ArrowUpIcon,
  ImagesIcon,
  LinkIcon,
  PlusIcon,
  UploadIcon,
  XIcon,
} from "lucide-react"

import { Button } from "@/design-system/primitives/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/design-system/primitives/dropdown-menu"
import {
  InputGroup,
  InputGroupButton,
  InputGroupTextarea,
} from "@/design-system/primitives/input-group"
import { cn } from "@/lib/utils"

type SelectedCreationContext = {
  label: string
  meta: string
  preview?: React.ReactNode
}

export function CreationComposer({
  prompt,
  reference,
  selectedContext,
  surface = "canvas",
  placeholder,
  inputRef,
  onPromptChange,
  onReferenceChange,
  onSubmit,
}: {
  prompt: string
  reference?: string
  selectedContext?: SelectedCreationContext
  surface?: "entry" | "canvas"
  placeholder?: string
  inputRef?: React.RefObject<HTMLTextAreaElement | null>
  onPromptChange: (value: string) => void
  onReferenceChange: (value?: string) => void
  onSubmit: () => void
}) {
  const uploadRef = React.useRef<HTMLInputElement>(null)

  return (
    <InputGroup className="flex-col items-stretch rounded-[var(--radius-card)] bg-background p-2">
      {(selectedContext || reference) && (
        <div className="flex flex-wrap gap-2 px-1 pb-1">
          {selectedContext && (
            <div className="flex items-center gap-2 rounded-[var(--radius)] bg-muted px-2 py-1 text-xs">
              {selectedContext.preview}
              <span>{selectedContext.label}</span>
              <span className="hidden text-muted-foreground sm:inline">{selectedContext.meta}</span>
            </div>
          )}
          {reference && (
            <div className="flex items-center gap-2 rounded-[var(--radius)] bg-muted px-2 py-1 text-xs">
              <LinkIcon className="size-3.5 text-muted-foreground" />
              <span className="max-w-72 truncate">{reference}</span>
              <InputGroupButton aria-label="Remove reference" size="icon-xs" onClick={() => onReferenceChange(undefined)}>
                <XIcon className="size-3.5" />
              </InputGroupButton>
            </div>
          )}
        </div>
      )}
      <InputGroupTextarea
        aria-label="Otto creation prompt"
        className={cn("w-full px-2.5 py-2 text-base leading-6", surface === "entry" ? "min-h-[78px]" : "min-h-[44px]")}
        placeholder={placeholder ?? (selectedContext ? "Describe what you would like to change" : "Describe an image or video to create")}
        ref={inputRef}
        value={prompt}
        onChange={(event) => onPromptChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && prompt.trim()) {
            event.preventDefault()
            onSubmit()
          }
        }}
      />
      <input
        hidden
        ref={uploadRef}
        type="file"
        accept="image/*"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onReferenceChange(file.name)
        }}
      />
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-label="Add a reference" size="icon-sm" variant="ghost"><PlusIcon /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Add a reference</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => uploadRef.current?.click()}><UploadIcon /> Upload image</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onReferenceChange("Warm gift-box hero · Library")}><ImagesIcon /> Choose from Library</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onReferenceChange("fikirtive.com/product")}><LinkIcon /> Add URL</DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="hidden text-xs text-muted-foreground sm:inline">Add context</span>
        </div>
        <Button aria-label="Send prompt" disabled={!prompt.trim()} size="icon-sm" variant="otto" onClick={onSubmit}><ArrowUpIcon /></Button>
      </div>
    </InputGroup>
  )
}
