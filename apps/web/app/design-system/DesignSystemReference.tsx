"use client";

import * as React from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { OttoAvatar, OTTO_MOODS } from "@/components/otto/OttoAvatar";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** §-numbered heading — mono index + sentence-case title, same rhythm every section. */
function SectionHeading({ index, title }: { index: string; title: string }) {
  return (
    <div className="mb-4 flex items-baseline gap-3">
      <span className="font-mono text-xs uppercase tracking-[var(--tracking-mono-label)] text-muted-foreground">
        {index}
      </span>
      <h2 className="text-lg font-semibold tracking-[-0.012em] text-foreground">{title}</h2>
    </div>
  );
}

/** Fill square + name + hex caption. `fill` is a registered Tailwind color utility, never raw hex. */
function Swatch({ name, hex, fill }: { name: string; hex: string; fill: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className={cn("h-16 w-full rounded-[var(--radius-card)] border border-border", fill)} />
      <div className="text-sm font-medium text-foreground">{name}</div>
      <div className="font-mono text-xs text-muted-foreground">{hex}</div>
    </div>
  );
}

function StateRow({
  label,
  hex,
  fill,
  soft,
  softFg,
  note,
}: {
  label: string;
  hex: string;
  fill: string;
  soft: string;
  softFg: string;
  note: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-[var(--radius-card)] border border-border bg-card p-4">
      <div className={cn("h-10 w-10 shrink-0 rounded-[var(--radius)] border border-border", fill)} />
      <span
        className={cn(
          "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
          soft,
          softFg
        )}
      >
        {label}
      </span>
      <span className="font-mono text-xs text-muted-foreground">{hex}</span>
      <span className="text-sm text-muted-foreground">{note}</span>
    </div>
  );
}

function ComponentCard({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{name}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-start gap-3">{children}</CardContent>
    </Card>
  );
}

/**
 * Official coral F app icon — verbatim master markup.
 * authority = docs/brand/logo/svg/f-app-icon-coral.svg, inline copy for this reference page only.
 */
function FIconMark() {
  return (
    <svg
      width={48}
      height={48}
      viewBox="0 0 1240 1240"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Fikirtive"
    >
      <rect width="1240" height="1240" rx="280" fill="#EC5828" />
      <g transform="translate(-60,10)">
        <g fill="none" stroke="#F5F1E8" strokeLinecap="round">
          <path d="M 478,430 C 450,570 452,750 466,880" strokeWidth="195" />
          <path d="M 468,462 C 545,298 745,232 855,300" strokeWidth="190" />
          <path d="M 488,650 C 600,618 690,624 775,658" strokeWidth="150" />
        </g>
        <g fill="#F5F1E8">
          <circle cx="448" cy="928" r="120" />
          <circle cx="893" cy="352" r="134" />
          <circle cx="798" cy="680" r="92" />
        </g>
      </g>
    </svg>
  );
}

const TYPE_SCALE = [
  { token: "--text-display", spec: "700 32px/1.1", sample: "The quick brown fox", monoLabel: false },
  { token: "--text-title", spec: "600 22px/1.15", sample: "The quick brown fox", monoLabel: false },
  { token: "--text-heading", spec: "600 16px/1.3", sample: "The quick brown fox", monoLabel: false },
  { token: "--text-body", spec: "400 14px/1.5", sample: "The quick brown fox", monoLabel: false },
  { token: "--text-body-medium", spec: "500 14px/1.55", sample: "The quick brown fox", monoLabel: false },
  { token: "--text-small", spec: "400 12.5px/1.5", sample: "The quick brown fox", monoLabel: false },
  { token: "--text-caption", spec: "500 11.5px/1.5", sample: "The quick brown fox", monoLabel: false },
  { token: "--text-mono-label", spec: "500 11px/1.4", sample: "RM 2,350.00", monoLabel: true },
  { token: "--text-mono-meta", spec: "400 12px/1.5", sample: "RM 2,350.00", monoLabel: false },
] as const;

export function DesignSystemReference() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-16 text-foreground">
      {/* §0 Header */}
      <header className="mb-14">
        <span
          className="text-foreground"
          style={{ fontWeight: 750, letterSpacing: "-0.03em", fontSize: 28 }}
        >
          fikirtive
        </span>
        <h1 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-foreground">
          Design system
        </h1>
        <p className="mt-1 text-base text-muted-foreground">The marketing OS.</p>
        <p className="mt-4 font-mono text-xs text-muted-foreground">
          source of truth docs/brand/colors.json · tokens live in app/globals.css (.gb) · v4, 20 Aug 2026
        </p>
      </header>

      <div className="flex flex-col gap-14">
        {/* §1 Foundation colors */}
        <section>
          <SectionHeading index="§1" title="Foundation colors" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
            <Swatch name="Ground" hex="#FAFAFC" fill="bg-background" />
            <Swatch name="Surface" hex="#FFFFFF" fill="bg-card" />
            <Swatch name="Chrome" hex="#F2F3F7" fill="bg-secondary" />
            <Swatch name="Line" hex="#E8E9EF" fill="bg-border" />
            <Swatch name="Line strong" hex="#DDDEE6" fill="bg-line-strong" />
            <Swatch name="Ink" hex="#16171C" fill="bg-primary" />
            <Swatch name="Ink 2" hex="#5B5F6C" fill="bg-muted-foreground" />
            <Swatch name="Ink 3 (faint)" hex="#9CA0AC" fill="bg-faint" />
            <Swatch name="Paper" hex="#F5F1E8" fill="bg-paper" />
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            Neutrals ~90% of any screen. Gradients ~8%. Coral ~2%.
          </p>
        </section>

        <Separator />

        {/* §2 Brand */}
        <section>
          <SectionHeading index="§2" title="Brand" />
          <div className="flex flex-wrap items-start gap-8">
            <div className="grid grid-cols-3 gap-4">
              <Swatch name="Coral" hex="#EC5828" fill="bg-brand" />
              <Swatch name="Coral soft" hex="#FBE7DC" fill="bg-brand-soft" />
              <Swatch name="Brand strong" hex="#C93F12" fill="bg-brand-strong" />
            </div>
            <div className="flex flex-col items-start gap-2">
              <FIconMark />
              <span className="font-mono text-xs text-muted-foreground">F app icon</span>
            </div>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            Coral marks Otto presence only. Human-action buttons are ink.
          </p>
        </section>

        <Separator />

        {/* §3 Semantic state colors */}
        <section>
          <SectionHeading index="§3" title="Semantic state colors" />
          <div className="flex flex-col gap-3">
            <StateRow
              label="Success"
              hex="#16A34A"
              fill="bg-success"
              soft="bg-success-soft"
              softFg="text-success-soft-foreground"
              note="Confirmations, completed jobs."
            />
            <StateRow
              label="Warning"
              hex="#D97706"
              fill="bg-warning"
              soft="bg-warning-soft"
              softFg="text-warning-soft-foreground"
              note="Needs attention, nothing is broken yet."
            />
            <StateRow
              label="Error"
              hex="#D02F35"
              fill="bg-error"
              soft="bg-error-soft"
              softFg="text-error-soft-foreground"
              note="Failed actions, blocking problems."
            />
            <StateRow
              label="Info"
              hex="#3B6FE6"
              fill="bg-info"
              soft="bg-info-soft"
              softFg="text-info-soft-foreground"
              note="Neutral explanation, no action needed."
            />
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            The palette&apos;s bad red ships one step darker in UI (#D02F35) to clear WCAG AA (audit
            #739).
          </p>
        </section>

        <Separator />

        {/* §4 Gradient sugar */}
        <section>
          <SectionHeading index="§4" title="Gradient sugar" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="grad-violet flex h-32 flex-col justify-between rounded-[var(--radius-card)] p-4">
              <span className="text-sm font-semibold">Violet</span>
              <span className="text-xs">Start tiles, template cards</span>
            </div>
            <div className="grad-peach flex h-32 flex-col justify-between rounded-[var(--radius-card)] p-4">
              <span className="text-sm font-semibold">Peach</span>
              <span className="text-xs">Campaign tiles, empty states</span>
            </div>
            <div className="grad-sky flex h-32 flex-col justify-between rounded-[var(--radius-card)] p-4">
              <span className="text-sm font-semibold">Sky</span>
              <span className="text-xs">Data cards, onboarding</span>
            </div>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            135°, two stops. Content accents only, never page frames. At most two per screen. Text on
            gradients uses the matching foreground tone.
          </p>
        </section>

        <Separator />

        {/* §5 Typography */}
        <section>
          <SectionHeading index="§5" title="Typography" />
          <p className="mb-4 text-sm text-muted-foreground">Geist (interface) + JetBrains Mono (data).</p>
          <div className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-card">
            {TYPE_SCALE.map((row) => (
              <div
                key={row.token}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <span
                  className={row.monoLabel ? "uppercase tracking-[var(--tracking-mono-label)]" : undefined}
                  style={{ font: `var(${row.token})` }}
                >
                  {row.sample}
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {row.token} · {row.spec}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-6 grid grid-cols-2 gap-6 sm:w-80">
            <div>
              <div className="mb-2 font-mono text-xs uppercase tracking-[var(--tracking-mono-label)] text-muted-foreground">
                Tabular
              </div>
              <div className="flex flex-col gap-1 font-mono text-sm tabular-nums text-foreground">
                <span>RM 1,240.00</span>
                <span>RM 87.50</span>
                <span>RM 12,350.00</span>
              </div>
            </div>
            <div>
              <div className="mb-2 font-mono text-xs uppercase tracking-[var(--tracking-mono-label)] text-muted-foreground">
                Proportional
              </div>
              <div className="flex flex-col gap-1 font-mono text-sm text-foreground">
                <span>RM 1,240.00</span>
                <span>RM 87.50</span>
                <span>RM 12,350.00</span>
              </div>
            </div>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">Numbers in columns use tabular figures.</p>
        </section>

        <Separator />

        {/* §6 Radius & elevation */}
        <section>
          <SectionHeading index="§6" title="Radius & elevation" />
          <div className="mb-6 flex flex-wrap gap-4">
            <div className="flex h-20 w-32 items-center justify-center rounded-[var(--radius)] border border-border bg-card text-center text-xs text-muted-foreground">
              14 · controls
            </div>
            <div className="flex h-20 w-32 items-center justify-center rounded-[var(--radius-card)] border border-border bg-card text-center text-xs text-muted-foreground">
              18 · cards
            </div>
            <div className="flex h-20 w-32 items-center justify-center rounded-[var(--radius-modal)] border border-border bg-card text-center text-xs text-muted-foreground">
              24 · modals
            </div>
          </div>
          <div className="flex flex-wrap gap-4">
            <div className="flex h-20 w-24 items-center justify-center rounded-[var(--radius-card)] border border-border bg-card font-mono text-xs text-muted-foreground shadow-[var(--shadow-xs)]">
              xs
            </div>
            <div className="flex h-20 w-24 items-center justify-center rounded-[var(--radius-card)] border border-border bg-card font-mono text-xs text-muted-foreground shadow-[var(--shadow-sm)]">
              sm
            </div>
            <div className="flex h-20 w-24 items-center justify-center rounded-[var(--radius-card)] border border-border bg-card font-mono text-xs text-muted-foreground shadow-[var(--shadow-md)]">
              md
            </div>
            <div className="flex h-20 w-24 items-center justify-center rounded-[var(--radius-card)] border border-border bg-card font-mono text-xs text-muted-foreground shadow-[var(--shadow-lg)]">
              lg
            </div>
            <div className="flex h-20 w-24 items-center justify-center rounded-[var(--radius-card)] border border-border bg-card font-mono text-xs text-muted-foreground shadow-[var(--shadow-xl)]">
              xl
            </div>
            <div className="flex h-20 w-32 items-center justify-center rounded-[var(--radius-card)] border border-border bg-card px-2 text-center font-mono text-xs text-muted-foreground shadow-[var(--shadow-brand)]">
              brand (Otto surfaces only)
            </div>
          </div>
        </section>

        <Separator />

        {/* §7 Motion */}
        <section>
          <SectionHeading index="§7" title="Motion" />
          <div className="mb-4 grid grid-cols-2 gap-x-8 gap-y-2 font-mono text-xs text-muted-foreground sm:grid-cols-4">
            <div>--dur-1 · 120ms</div>
            <div>--dur-2 · 150ms</div>
            <div>--dur-3 · 200ms</div>
            <div>--dur-sweep · 600ms</div>
          </div>
          <div className="mb-6 flex flex-col gap-1 font-mono text-xs text-muted-foreground">
            <div>--ease-out · cubic-bezier(0.22, 1, 0.36, 1)</div>
            <div>--ease-spring · cubic-bezier(0.34, 1.56, 0.64, 1)</div>
          </div>
          <div className="flex flex-wrap gap-4">
            <Button
              type="button"
              variant="outline"
              className="transition-colors duration-[var(--dur-1)] ease-[var(--ease-out)]"
            >
              dur-1 (120ms)
            </Button>
            <Button
              type="button"
              variant="outline"
              className="transition-colors duration-[var(--dur-2)] ease-[var(--ease-out)]"
            >
              dur-2 (150ms)
            </Button>
            <Button
              type="button"
              variant="outline"
              className="transition-colors duration-[var(--dur-3)] ease-[var(--ease-out)]"
            >
              dur-3 (200ms)
            </Button>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">Reduced motion is honored globally.</p>
        </section>

        <Separator />

        {/* §8 Focus */}
        <section>
          <SectionHeading index="§8" title="Focus" />
          <Input aria-label="Focus ring demo" placeholder="Tab into me" className="max-w-sm" />
          <p className="mt-2 text-sm text-muted-foreground">
            Focus ring is ink — coral is reserved for Otto presence (brand rule), and the ink keyline
            reads at 17:1.
          </p>
        </section>

        <Separator />

        {/* §9 Components */}
        <section>
          <SectionHeading index="§9" title="Components" />
          <TooltipProvider>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <ComponentCard name="Button">
                <Button variant="default">Default</Button>
                <Button variant="brand">Brand</Button>
                <Button variant="soft">Soft</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="outline">Outline</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="destructive">Destructive</Button>
                <Button variant="link">Link</Button>
                <Button variant="default" disabled>
                  Disabled
                </Button>
              </ComponentCard>

              <ComponentCard name="Badge">
                <Badge variant="default">Default</Badge>
                <Badge variant="brand">Brand</Badge>
                <Badge variant="soft">Soft</Badge>
                <Badge variant="outline">Outline</Badge>
                <Badge variant="success">Success</Badge>
                <Badge variant="warning">Warning</Badge>
                <Badge variant="info">Info</Badge>
                <Badge variant="destructive">Destructive</Badge>
              </ComponentCard>

              <ComponentCard name="Alert">
                <Alert className="w-full">
                  <AlertTitle>Heads up</AlertTitle>
                  <AlertDescription>This is a standing notice inside a page.</AlertDescription>
                </Alert>
              </ComponentCard>

              <ComponentCard name="Input">
                <Input aria-label="Merchant name" placeholder="Merchant name" className="w-full" />
              </ComponentCard>

              <ComponentCard name="Textarea">
                <Textarea aria-label="Caption" placeholder="Write a caption…" className="w-full" />
              </ComponentCard>

              <ComponentCard name="Label">
                <div className="flex w-full flex-col gap-1.5">
                  <Label htmlFor="ds-label-demo">Campaign name</Label>
                  <Input id="ds-label-demo" placeholder="Ramadan drop" className="w-full" />
                </div>
              </ComponentCard>

              <ComponentCard name="Checkbox">
                <div className="flex items-center gap-2">
                  <Checkbox id="ds-checkbox-demo" defaultChecked />
                  <Label htmlFor="ds-checkbox-demo">Notify me when it&apos;s done</Label>
                </div>
              </ComponentCard>

              <ComponentCard name="Switch">
                <div className="flex items-center gap-2">
                  <Switch id="ds-switch-demo" defaultChecked />
                  <Label htmlFor="ds-switch-demo">Auto-publish</Label>
                </div>
              </ComponentCard>

              <ComponentCard name="Select">
                <Select defaultValue="tiktok">
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Channel" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tiktok">TikTok</SelectItem>
                    <SelectItem value="instagram">Instagram</SelectItem>
                    <SelectItem value="facebook">Facebook</SelectItem>
                  </SelectContent>
                </Select>
              </ComponentCard>

              <ComponentCard name="Tabs">
                <Tabs defaultValue="plan" className="w-full">
                  <TabsList>
                    <TabsTrigger value="plan">Plan</TabsTrigger>
                    <TabsTrigger value="calendar">Calendar</TabsTrigger>
                    <TabsTrigger value="queue">Queue</TabsTrigger>
                  </TabsList>
                  <TabsContent value="plan" className="text-sm text-muted-foreground">
                    Plan content.
                  </TabsContent>
                  <TabsContent value="calendar" className="text-sm text-muted-foreground">
                    Calendar content.
                  </TabsContent>
                  <TabsContent value="queue" className="text-sm text-muted-foreground">
                    Queue content.
                  </TabsContent>
                </Tabs>
              </ComponentCard>

              <ComponentCard name="Card">
                <Card className="w-full">
                  <CardHeader>
                    <CardTitle>Nested card</CardTitle>
                    <CardDescription>Header, content, footer.</CardDescription>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    Body content goes here.
                  </CardContent>
                  <CardFooter>
                    <Button size="sm">Action</Button>
                  </CardFooter>
                </Card>
              </ComponentCard>

              <ComponentCard name="Separator">
                <div className="flex w-full flex-col gap-2">
                  <span className="text-sm text-muted-foreground">Above</span>
                  <Separator />
                  <span className="text-sm text-muted-foreground">Below</span>
                </div>
              </ComponentCard>

              <ComponentCard name="Skeleton">
                <div className="flex w-full flex-col gap-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              </ComponentCard>

              <ComponentCard name="Progress">
                <Progress value={60} className="w-full" />
              </ComponentCard>

              <ComponentCard name="Avatar">
                <Avatar>
                  <AvatarFallback>F</AvatarFallback>
                </Avatar>
              </ComponentCard>

              <ComponentCard name="Tooltip">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="sm">
                      Hover me
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Otto explains here.</TooltipContent>
                </Tooltip>
              </ComponentCard>

              <ComponentCard name="Popover">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm">
                      Open popover
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent>Arbitrary content — filters, pickers, explanations.</PopoverContent>
                </Popover>
              </ComponentCard>

              <ComponentCard name="Dropdown menu">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      Actions
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem>Rename</DropdownMenuItem>
                    <DropdownMenuItem>Duplicate</DropdownMenuItem>
                    <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </ComponentCard>

              <ComponentCard name="Dialog">
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm">
                      Open dialog
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Rename campaign</DialogTitle>
                      <DialogDescription>
                        This only changes the name shown to your team.
                      </DialogDescription>
                    </DialogHeader>
                    <Input aria-label="Campaign name" placeholder="Campaign name" />
                    <DialogFooter>
                      <Button variant="ghost" size="sm">
                        Cancel
                      </Button>
                      <Button size="sm">Save</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </ComponentCard>

              <ComponentCard name="Alert dialog">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm">
                      Delete asset
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this asset?</AlertDialogTitle>
                      <AlertDialogDescription>This can&apos;t be undone.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction>Confirm</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </ComponentCard>

              <ComponentCard name="Sheet">
                <Sheet>
                  <SheetTrigger asChild>
                    <Button variant="outline" size="sm">
                      Open sheet
                    </Button>
                  </SheetTrigger>
                  <SheetContent>
                    <SheetHeader>
                      <SheetTitle>Asset details</SheetTitle>
                      <SheetDescription>
                        An edge-anchored panel, too tall for a dialog.
                      </SheetDescription>
                    </SheetHeader>
                  </SheetContent>
                </Sheet>
              </ComponentCard>

              <ComponentCard name="Sonner">
                {/* Toasts render through the root layout's global <Toaster /> — a second mount would double-fire. */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => toast("Saved — nothing was charged.")}
                >
                  Fire toast
                </Button>
              </ComponentCard>
            </div>
          </TooltipProvider>
        </section>

        <Separator />

        {/* §10 Otto */}
        <section>
          <SectionHeading index="§10" title="Otto" />
          <div className="flex flex-wrap gap-6">
            {OTTO_MOODS.map((mood) => (
              <div key={mood} className="flex flex-col items-center gap-2">
                <OttoAvatar size={48} mood={mood} />
                <span className="text-xs text-muted-foreground">
                  {mood.charAt(0).toUpperCase() + mood.slice(1)}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            Otto is the coral cloud — four asymmetric lobes, vertical bar eyes. Coral belongs to
            Otto; the avatar masters live in docs/brand/otto/.
          </p>
        </section>

        <Separator />

        {/* §11 Voice & grammar */}
        <section>
          <SectionHeading index="§11" title="Voice & grammar" />
          <Card>
            <CardContent className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm text-foreground sm:grid-cols-2">
              <div>American spelling</div>
              <div>Sentence case everywhere</div>
              <div>Oxford comma</div>
              <div className="font-mono">RM 2,350.00</div>
              <div className="font-mono">1,240 cr</div>
              <div className="font-mono">12 Aug 2026</div>
              <div className="sm:col-span-2">
                Product words: Fikirtive (prose), fikirtive (wordmark), Otto, credits, canvas
              </div>
              <div className="text-muted-foreground sm:col-span-2">
                FIKIRTIVE all-caps is deprecated
              </div>
              <div className="text-muted-foreground sm:col-span-2">
                No &quot;Coming soon&quot;, no vendor names, no unsourced numbers.
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}

export default DesignSystemReference;
