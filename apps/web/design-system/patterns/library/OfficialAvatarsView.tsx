"use client"

import Image from "next/image"
import Link from "next/link"
import * as React from "react"
import {
  Check,
  ChevronDown,
  Heart,
  Info,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react"

import { Badge } from "@/design-system/primitives/badge"
import { Button, buttonVariants } from "@/design-system/primitives/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/design-system/primitives/dropdown-menu"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/design-system/primitives/input-group"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/design-system/primitives/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/design-system/primitives/toggle-group"
import { CANVAS_REVIEW_HREF } from "@/design-system/patterns/canvas/review-links"
import { cn } from "@/lib/utils"

import { OFFICIAL_AVATARS } from "./fixtures"
import type { OfficialAvatarAgeGroup, OfficialAvatarGender } from "./model"

type GenderFilter = "all" | OfficialAvatarGender
type AgeFilter = "all" | OfficialAvatarAgeGroup

const INDUSTRIES = ["All", "F&B", "Retail", "Services", "Education", "Lifestyle"] as const
const VIBES = ["all", "Warm", "Confident", "Calm", "Creative", "Reliable"] as const

function AvatarFilterButton({ children, ...props }: React.ComponentProps<typeof Button>) {
  return (
    <Button {...props} variant="outline" size="sm" className="gap-1.5 bg-card font-medium shadow-none">
      {children}
      <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
    </Button>
  )
}

function AvatarCard({
  avatar,
  selected,
  onSelect,
}: {
  avatar: (typeof OFFICIAL_AVATARS)[number]
  selected: boolean
  onSelect: () => void
}) {
  return (
    <Button
      variant="ghost"
      aria-label={`Preview ${avatar.name}`}
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "group h-auto min-w-0 flex-col items-stretch justify-start overflow-hidden whitespace-normal rounded-[var(--radius-card)] border border-border bg-card p-0 text-left shadow-none",
        "hover:border-foreground/25 hover:bg-card aria-pressed:bg-card focus-visible:ring-offset-2",
        selected && "border-foreground ring-1 ring-ring/20",
      )}
    >
      <span className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
        <Image
          src={avatar.portrait}
          alt={`${avatar.name}, ${avatar.demographic}`}
          fill
          className="object-cover transition-transform duration-[var(--dur-3)] ease-[var(--ease-out)] group-hover:scale-[1.015] motion-reduce:transition-none"
          sizes="(max-width: 1200px) 30vw, 280px"
        />
        <span className="absolute left-2 top-2 flex flex-col items-start gap-1">
          <Badge className="border-transparent bg-foreground/75 px-2 py-0.5 text-background backdrop-blur-sm">AI generated</Badge>
          <Badge variant="outline" className="border-background/60 bg-background/85 px-2 py-0.5 font-medium backdrop-blur-sm">
            <ShieldCheck aria-hidden />
            Commercially cleared
          </Badge>
        </span>
      </span>

      <span className="space-y-2 p-3">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-sm font-semibold">{avatar.name}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">{avatar.mention}</span>
        </span>
        <span className="block min-h-9 text-xs font-normal leading-[1.45] text-foreground">{avatar.tagline}</span>
        <span className="block text-xs font-normal text-muted-foreground">{avatar.demographic}</span>
        <span className="flex flex-wrap gap-1.5 pt-0.5">
          {avatar.vibeTags.map((vibe) => (
            <Badge key={vibe} variant="default" className="px-2 py-0 text-xs font-medium">{vibe}</Badge>
          ))}
        </span>
      </span>
    </Button>
  )
}

function AvatarDetail({
  avatar,
  favorite,
  onFavoriteChange,
  onClose,
}: {
  avatar: (typeof OFFICIAL_AVATARS)[number]
  favorite: boolean
  onFavoriteChange: () => void
  onClose: () => void
}) {
  return (
    <aside aria-label={`${avatar.name} official avatar details`} className="sticky top-0 flex h-[calc(100dvh-16rem)] w-[360px] shrink-0 self-start flex-col overflow-hidden border-l border-border bg-background">
      <div className="flex h-12 items-center border-b border-border px-4">
        <Badge variant="outline" className="font-medium"><ShieldCheck aria-hidden />Fikirtive official avatar</Badge>
        <Button variant="ghost" size="icon-xs" className="ml-auto" aria-label="Close avatar details" onClick={onClose}>
          <X aria-hidden />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-muted">
          <Image src={avatar.portrait} alt={`${avatar.name} portrait`} width={720} height={540} className="aspect-[4/3] w-full object-cover" priority />
        </div>

        <div>
          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-semibold tracking-[-0.02em]">{avatar.name}</h2>
            <span className="text-sm text-muted-foreground">{avatar.mention}</span>
          </div>
          <p className="mt-1 text-sm">{avatar.tagline}</p>
          <p className="mt-2 text-xs text-muted-foreground">{avatar.demographic}</p>
          <p className="mt-1 text-xs text-muted-foreground">Great for {avatar.industries.join(", ")}.</p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {avatar.vibeTags.map((vibe) => <Badge key={vibe} variant="default" className="font-medium">{vibe}</Badge>)}
        </div>

        <Tabs defaultValue="sheet" className="gap-2 border-t border-border pt-4">
          <TabsList className="w-full rounded-none bg-transparent p-0">
            <TabsTrigger value="sheet" className="rounded-none border-b-2 border-transparent py-2 data-active:border-foreground data-active:bg-transparent data-active:shadow-none">Character sheet</TabsTrigger>
            <TabsTrigger value="action" className="rounded-none border-b-2 border-transparent py-2 data-active:border-foreground data-active:bg-transparent data-active:shadow-none">In action</TabsTrigger>
          </TabsList>
          <TabsContent value="sheet">
            <div className="overflow-hidden rounded-lg border border-border bg-muted">
              <Image
                src={avatar.sheet ?? avatar.portrait}
                alt={avatar.sheet ? `${avatar.name} four-view character sheet` : `${avatar.name} reference portrait`}
                width={960}
                height={640}
                className={cn("w-full", avatar.sheet ? "aspect-[4/1] object-contain" : "aspect-[4/3] object-cover")}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Default wardrobe: {avatar.wardrobe}.</p>
          </TabsContent>
          <TabsContent value="action">
            {avatar.sceneStills?.length ? (
              <div className="grid grid-cols-2 gap-2">
                {avatar.sceneStills.map((scene, index) => (
                  <div key={scene} className="overflow-hidden rounded-lg border border-border bg-muted">
                    <Image src={scene} alt={`${avatar.name} sample scene ${index + 1}`} width={360} height={270} className="aspect-[4/3] w-full object-cover" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-[var(--radius-card)] border border-border bg-muted p-4 text-sm text-muted-foreground">
                Scene samples are not included in this review fixture.
              </div>
            )}
          </TabsContent>
        </Tabs>

        <div className="space-y-3 border-t border-border pt-4 text-xs">
          <div className="flex items-start gap-2">
            <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
            <div>
              <p className="font-semibold">Cleared for commercial use</p>
              <p className="mt-0.5 text-muted-foreground">No likeness rights are needed.</p>
            </div>
          </div>
          <div className="flex items-start gap-2 text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>Voice is set per video, not fixed to the actor.</p>
          </div>
        </div>

      </div>

      <div className="grid grid-cols-[1fr_auto] gap-2 border-t border-border bg-background p-4">
        <Link href={`${CANVAS_REVIEW_HREF}?context=${encodeURIComponent(avatar.id)}&mention=${encodeURIComponent(avatar.mention)}`} className={cn(buttonVariants({ size: "sm" }), "w-full")}>
          <Sparkles aria-hidden />
          Use in Canvas
        </Link>
        <Button variant="secondary" size="sm" aria-label={favorite ? "Remove from favorites" : "Add to favorites"} aria-pressed={favorite} onClick={onFavoriteChange}>
          <Heart className={cn(favorite && "fill-current")} aria-hidden />
          {favorite ? "Favorited" : "Favorite"}
        </Button>
      </div>
    </aside>
  )
}

export function OfficialAvatarsView({
  selectedAvatarId,
  favoriteAvatarIds,
  onSelectAvatar,
  onCloseAvatar,
  onToggleFavorite,
}: {
  selectedAvatarId?: string
  favoriteAvatarIds: ReadonlySet<string>
  onSelectAvatar: (avatarId: string) => void
  onCloseAvatar: () => void
  onToggleFavorite: (avatarId: string) => void
}) {
  const [query, setQuery] = React.useState("")
  const [gender, setGender] = React.useState<GenderFilter>("all")
  const [age, setAge] = React.useState<AgeFilter>("all")
  const [vibe, setVibe] = React.useState<(typeof VIBES)[number]>("all")
  const [industry, setIndustry] = React.useState<(typeof INDUSTRIES)[number]>("All")
  const visible = OFFICIAL_AVATARS.filter((avatar) => {
    const searchable = [avatar.name, avatar.mention, avatar.tagline, avatar.demographic, ...avatar.vibeTags, ...avatar.industries].join(" ").toLowerCase()
    if (query && !searchable.includes(query.toLowerCase())) return false
    if (gender !== "all" && avatar.gender !== gender) return false
    if (age !== "all" && avatar.ageGroup !== age) return false
    if (vibe !== "all" && !avatar.vibeTags.includes(vibe)) return false
    if (industry !== "All" && !avatar.industries.includes(industry)) return false
    return true
  })
  const selectedAvatar = visible.find((avatar) => avatar.id === selectedAvatarId)

  React.useEffect(() => {
    if (selectedAvatarId && !selectedAvatar) onCloseAvatar()
  }, [onCloseAvatar, selectedAvatar, selectedAvatarId])

  function clearFilters() {
    setQuery("")
    setGender("all")
    setAge("all")
    setVibe("all")
    setIndustry("All")
  }

  return (
    <div className="flex min-w-0 items-start">
      <div className="min-w-0 flex-1 pr-5">
        <div className="flex flex-wrap items-center gap-2">
          <InputGroup className="min-h-9 min-w-56 flex-1 max-w-sm bg-background shadow-none">
            <InputGroupAddon><Search aria-hidden /></InputGroupAddon>
            <InputGroupInput aria-label="Search official avatars" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search official avatars" className="h-9 text-sm" />
          </InputGroup>

          <DropdownMenu>
            <DropdownMenuTrigger render={<AvatarFilterButton>{gender === "all" ? "Gender" : gender}</AvatarFilterButton>} />
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup value={gender} onValueChange={(value) => setGender(value as GenderFilter)}>
                <DropdownMenuLabel>Gender</DropdownMenuLabel>
                <DropdownMenuRadioItem value="all">All genders</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="Women">Women</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="Men">Men</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger render={<AvatarFilterButton>{age === "all" ? "Age range" : age}</AvatarFilterButton>} />
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup value={age} onValueChange={(value) => setAge(value as AgeFilter)}>
                <DropdownMenuLabel>Age range</DropdownMenuLabel>
                <DropdownMenuRadioItem value="all">Any age</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="20s">20s</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="30s">30s</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger render={<AvatarFilterButton>{vibe === "all" ? "Vibe" : vibe}</AvatarFilterButton>} />
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup value={vibe} onValueChange={(value) => setVibe(value as (typeof VIBES)[number])}>
                <DropdownMenuLabel>Vibe</DropdownMenuLabel>
                {VIBES.map((item) => <DropdownMenuRadioItem key={item} value={item}>{item === "all" ? "Any vibe" : item}</DropdownMenuRadioItem>)}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold">Choose by use case</p>
          <ToggleGroup type="single" value={industry} onValueChange={(value) => { if (value) setIndustry(value as (typeof INDUSTRIES)[number]) }} variant="outline" size="sm" className="flex flex-wrap gap-2">
            {INDUSTRIES.map((item) => <ToggleGroupItem key={item} value={item} className="min-w-20 px-3">{item}</ToggleGroupItem>)}
          </ToggleGroup>
        </div>

        <div className="mt-5 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">{visible.length} official avatar{visible.length === 1 ? "" : "s"}</p>
          {(query || gender !== "all" || age !== "all" || vibe !== "all" || industry !== "All") ? (
            <Button variant="ghost" size="xs" onClick={clearFilters}>Clear filters</Button>
          ) : null}
        </div>

        {visible.length ? (
          <div className="mt-3 grid grid-cols-3 gap-3">
            {visible.map((avatar) => (
              <AvatarCard key={avatar.id} avatar={avatar} selected={avatar.id === selectedAvatarId} onSelect={() => onSelectAvatar(avatar.id)} />
            ))}
          </div>
        ) : (
          <div className="mt-3 flex min-h-64 flex-col items-center justify-center rounded-[var(--radius-card)] border border-border bg-muted text-center">
            <Search className="size-5 text-muted-foreground" aria-hidden />
            <h3 className="mt-3 text-sm font-semibold">No avatars match these filters</h3>
            <p className="mt-1 text-xs text-muted-foreground">Try another search or clear a filter.</p>
            <Button variant="secondary" size="sm" className="mt-4" onClick={clearFilters}>Clear filters</Button>
          </div>
        )}
      </div>

      {selectedAvatar ? (
        <AvatarDetail
          avatar={selectedAvatar}
          favorite={favoriteAvatarIds.has(selectedAvatar.id)}
          onFavoriteChange={() => onToggleFavorite(selectedAvatar.id)}
          onClose={onCloseAvatar}
        />
      ) : null}
    </div>
  )
}

export function OfficialAvatarFavorites({
  avatarIds,
  onSelectAvatar,
}: {
  avatarIds: ReadonlySet<string>
  onSelectAvatar: (avatarId: string) => void
}) {
  const avatars = OFFICIAL_AVATARS.filter((avatar) => avatarIds.has(avatar.id))
  if (!avatars.length) return null

  return (
    <section className="mt-6 border-t border-border pt-5" aria-labelledby="favorite-official-avatars">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="favorite-official-avatars" className="text-sm font-semibold">Official avatars</h2>
        <span className="text-xs text-muted-foreground">{avatars.length} saved</span>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-4">
        {avatars.map((avatar) => (
          <AvatarCard key={avatar.id} avatar={avatar} selected={false} onSelect={() => onSelectAvatar(avatar.id)} />
        ))}
      </div>
    </section>
  )
}
