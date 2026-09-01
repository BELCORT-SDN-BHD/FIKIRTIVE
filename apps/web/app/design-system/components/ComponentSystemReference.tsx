"use client"

import { useState, type ReactNode } from "react"
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Ellipsis,
  Info,
  Mail,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react"
import { toast } from "@/components/ui/toast"

import { FikirtiveMark } from "@/components/brand/FikirtiveMark"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
} from "@/components/ui/alert-dialog"
import { Avatar, AvatarBadge, AvatarFallback, AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { Calendar } from "@/components/ui/calendar"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Toggle } from "@/components/ui/toggle"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const sectionId = title.toLowerCase().replaceAll(" and ", "-").replaceAll(" ", "-")

  return (
    <section id={sectionId} className="scroll-mt-6 border-t border-border py-10 md:py-12">
      <div className="grid gap-7 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-12">
        <div>
          <h2 className="text-base font-semibold tracking-[-0.015em] text-foreground">{title}</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
        <div className="min-w-0">{children}</div>
      </div>
    </section>
  )
}

function Preview({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 border border-border bg-card ${className}`}>
      <div className="border-b border-border px-4 py-2.5 font-mono text-[11px] text-muted-foreground">{label}</div>
      <div className="p-5 md:p-6">{children}</div>
    </div>
  )
}

function StateLabel({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[11px] text-muted-foreground">{children}</span>
}

function CalendarPreview() {
  const [date, setDate] = useState<Date | undefined>(new Date(2026, 7, 27, 12))

  return (
    <Calendar
      mode="single"
      defaultMonth={new Date(2026, 7, 1, 12)}
      selected={date}
      onSelect={setDate}
      timeZone="Asia/Kuala_Lumpur"
    />
  )
}

export function ComponentSystemReference() {
  return (
    <TooltipProvider>
      <main
        className="mx-auto w-full max-w-6xl px-5 py-12 text-foreground sm:px-8 md:py-16"
        data-scope="component-library-only"
      >
        <header className="pb-12 md:pb-16">
          <a
            href="/design-system"
            className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors duration-[var(--dur-1)] ease-[var(--ease-standard)] hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Foundations
          </a>
          <div className="mt-10 flex items-center gap-3">
            <FikirtiveMark size={36} />
            <span className="text-lg font-semibold tracking-[-0.025em]">fikirtive</span>
          </div>
          <div className="mt-10 max-w-3xl">
            <p className="text-sm font-medium text-muted-foreground">Component library · Phase 1B</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
              One predictable component language.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
              Shared shadcn primitives, adapted to the approved Fikirtive foundations. This is a finite component and state review; product patterns come next.
            </p>
          </div>
          <div className="mt-8 flex flex-wrap gap-2">
            <Badge variant="success">Ready for review</Badge>
            <Badge variant="outline">6 categories</Badge>
            <Badge variant="outline">Interactive</Badge>
          </div>
        </header>

        <Section title="Actions" description="Human actions use ink. Coral appears only when Otto is visibly the actor or owner.">
          <div className="grid gap-4">
            <Preview label="Button · hierarchy and state">
              <div className="grid gap-6">
                <div className="flex flex-wrap items-center gap-3">
                  <Button>Primary action</Button>
                  <Button variant="secondary">Secondary</Button>
                  <Button variant="outline">Outline</Button>
                  <Button variant="ghost">Ghost</Button>
                  <Button variant="destructive-secondary">Delete</Button>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="otto"><Sparkles data-icon="inline-start" />Ask Otto</Button>
                  <Button variant="otto-soft"><Sparkles data-icon="inline-start" />Otto suggestion</Button>
                  <Button disabled><Spinner data-icon="inline-start" />Loading</Button>
                  <Button disabled>Disabled</Button>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <Button size="xs">Extra small</Button>
                  <Button size="sm">Small</Button>
                  <Button>Default</Button>
                  <Button size="lg">Large</Button>
                  <Button size="icon" variant="secondary" aria-label="Add item"><Plus /></Button>
                </div>
              </div>
            </Preview>

            <div className="grid gap-4 md:grid-cols-2">
              <Preview label="Button group">
                <ButtonGroup>
                  <Button variant="secondary" size="sm">Back</Button>
                  <Button size="sm">Continue <ArrowRight data-icon="inline-end" /></Button>
                </ButtonGroup>
              </Preview>
              <Preview label="Toggle controls">
                <div className="flex flex-wrap items-center gap-4">
                  <Toggle aria-label="Toggle notifications"><Bell /></Toggle>
                  <ToggleGroup type="single" defaultValue="week" variant="outline" aria-label="View density">
                    <ToggleGroupItem value="day">Day</ToggleGroupItem>
                    <ToggleGroupItem value="week">Week</ToggleGroupItem>
                    <ToggleGroupItem value="month">Month</ToggleGroupItem>
                  </ToggleGroup>
                </div>
              </Preview>
            </div>
          </div>
        </Section>

        <Section title="Forms and selection" description="Every control has a clear label, help, error, focus, and disabled state.">
          <div className="grid gap-4">
            <Preview label="Text fields · complete state set">
              <FieldGroup className="grid gap-5 md:grid-cols-2">
                <Field>
                  <div className="flex items-center justify-between gap-3"><FieldLabel htmlFor="default-name">Default</FieldLabel><StateLabel>Default</StateLabel></div>
                  <Input id="default-name" placeholder="Campaign name" />
                  <FieldDescription>Shown to your workspace.</FieldDescription>
                </Field>
                <Field>
                  <div className="flex items-center justify-between gap-3"><FieldLabel htmlFor="filled-email">Email</FieldLabel><StateLabel>Filled</StateLabel></div>
                  <Input id="filled-email" defaultValue="hello@fikirtive.com" />
                </Field>
                <Field data-invalid="true">
                  <div className="flex items-center justify-between gap-3"><FieldLabel htmlFor="invalid-url">Website</FieldLabel><StateLabel>Invalid</StateLabel></div>
                  <Input id="invalid-url" aria-invalid="true" defaultValue="fikirtive" />
                  <FieldError>Enter a complete URL.</FieldError>
                </Field>
                <Field data-disabled="true">
                  <div className="flex items-center justify-between gap-3"><FieldLabel htmlFor="disabled-id">Workspace ID</FieldLabel><StateLabel>Disabled</StateLabel></div>
                  <Input id="disabled-id" disabled defaultValue="FK-2048" />
                </Field>
              </FieldGroup>
            </Preview>

            <div className="grid gap-4 md:grid-cols-2">
              <Preview label="Composed input">
                <Field>
                  <FieldLabel htmlFor="search-assets">Search</FieldLabel>
                  <InputGroup>
                    <InputGroupAddon><Search /></InputGroupAddon>
                    <InputGroupInput id="search-assets" placeholder="Search assets" />
                  </InputGroup>
                </Field>
              </Preview>
              <Preview label="Long-form input">
                <Field>
                  <FieldLabel htmlFor="brief">Brief</FieldLabel>
                  <Textarea id="brief" placeholder="Describe the outcome you want…" />
                  <FieldDescription>Keep it specific and outcome-led.</FieldDescription>
                </Field>
              </Preview>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Preview label="Selection">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="format">Format</FieldLabel>
                    <Select defaultValue="social">
                      <SelectTrigger id="format"><SelectValue placeholder="Choose a format" /></SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>Creative format</SelectLabel>
                          <SelectItem value="social">Social post</SelectItem>
                          <SelectItem value="story">Story</SelectItem>
                          <SelectItem value="video">Short video</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="language">Native select</FieldLabel>
                    <NativeSelect id="language" className="w-full" defaultValue="en">
                      <NativeSelectOption value="en">English</NativeSelectOption>
                      <NativeSelectOption value="ms">Bahasa Melayu</NativeSelectOption>
                    </NativeSelect>
                  </Field>
                </FieldGroup>
              </Preview>
              <Preview label="Choice controls">
                <div className="grid gap-5">
                  <label className="flex items-start gap-3 text-sm">
                    <Checkbox defaultChecked aria-label="Include brand voice" />
                    <span><span className="font-medium">Include brand voice</span><span className="mt-1 block text-muted-foreground">Apply approved writing rules.</span></span>
                  </label>
                  <label className="flex items-center justify-between gap-4 text-sm">
                    <span><span className="font-medium">Email updates</span><span className="mt-1 block text-muted-foreground">Send progress notifications.</span></span>
                    <Switch defaultChecked aria-label="Email updates" />
                  </label>
                  <label className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
                    <span>Unavailable setting</span>
                    <Switch disabled aria-label="Unavailable setting" />
                  </label>
                </div>
              </Preview>
            </div>

            <Preview label="Verification code">
              <Field className="max-w-sm">
                <FieldLabel>Verification code</FieldLabel>
                <InputOTP maxLength={6}>
                  <InputOTPGroup>
                    <InputOTPSlot index={0} /><InputOTPSlot index={1} /><InputOTPSlot index={2} />
                  </InputOTPGroup>
                  <InputOTPSeparator />
                  <InputOTPGroup>
                    <InputOTPSlot index={3} /><InputOTPSlot index={4} /><InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
              </Field>
            </Preview>

            <div className="grid gap-4 lg:grid-cols-2">
              <Preview label="Radio group · one choice">
                <FieldSet>
                  <FieldLegend variant="label">Publishing cadence</FieldLegend>
                  <FieldDescription>Choose one default for this workspace.</FieldDescription>
                  <RadioGroup defaultValue="weekly">
                    <Field orientation="horizontal">
                      <RadioGroupItem value="daily" id="cadence-daily" />
                      <FieldLabel htmlFor="cadence-daily" className="font-normal">Daily</FieldLabel>
                    </Field>
                    <Field orientation="horizontal">
                      <RadioGroupItem value="weekly" id="cadence-weekly" />
                      <FieldLabel htmlFor="cadence-weekly" className="font-normal">Weekly</FieldLabel>
                    </Field>
                    <Field orientation="horizontal" data-disabled="true">
                      <RadioGroupItem value="custom" id="cadence-custom" disabled />
                      <FieldLabel htmlFor="cadence-custom" className="font-normal">Custom schedule</FieldLabel>
                    </Field>
                  </RadioGroup>
                </FieldSet>
              </Preview>
              <Preview label="Calendar · locale and timezone safe">
                <CalendarPreview />
              </Preview>
            </div>
          </div>
        </Section>

        <Section title="Navigation" description="Orientation and view switching stay quiet, compact, and keyboard accessible.">
          <div className="grid gap-4">
            <Preview label="Breadcrumb">
              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem><BreadcrumbLink href="#">Workspace</BreadcrumbLink></BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem><BreadcrumbLink href="#">Campaigns</BreadcrumbLink></BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem><BreadcrumbPage>Summer launch</BreadcrumbPage></BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            </Preview>
            <Preview label="Tabs">
              <Tabs defaultValue="overview">
                <TabsList>
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="activity">Activity</TabsTrigger>
                  <TabsTrigger value="settings">Settings</TabsTrigger>
                </TabsList>
                <TabsContent value="overview" className="pt-3 text-sm text-muted-foreground">A calm content area follows the active view.</TabsContent>
                <TabsContent value="activity" className="pt-3 text-sm text-muted-foreground">Recent changes appear here.</TabsContent>
                <TabsContent value="settings" className="pt-3 text-sm text-muted-foreground">Workspace preferences appear here.</TabsContent>
              </Tabs>
            </Preview>
            <div className="grid gap-4 lg:grid-cols-2">
              <Preview label="Accordion · disclosure">
                <Accordion defaultValue={["approval"]}>
                  <AccordionItem value="approval">
                    <AccordionTrigger>What needs approval?</AccordionTrigger>
                    <AccordionContent className="text-muted-foreground">Publishing, spend, and destructive actions remain explicit decisions.</AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="history">
                    <AccordionTrigger>Where is history stored?</AccordionTrigger>
                    <AccordionContent className="text-muted-foreground">Activity stays attached to the workspace and affected item.</AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="unavailable" disabled>
                    <AccordionTrigger>Unavailable section</AccordionTrigger>
                    <AccordionContent>This content is unavailable.</AccordionContent>
                  </AccordionItem>
                </Accordion>
              </Preview>
              <Preview label="Pagination · page position">
                <Pagination className="justify-start">
                  <PaginationContent>
                    <PaginationItem><PaginationPrevious href="#navigation" /></PaginationItem>
                    <PaginationItem><PaginationLink href="#navigation">1</PaginationLink></PaginationItem>
                    <PaginationItem><PaginationLink href="#navigation" isActive>2</PaginationLink></PaginationItem>
                    <PaginationItem><PaginationLink href="#navigation">3</PaginationLink></PaginationItem>
                    <PaginationItem><PaginationEllipsis /></PaginationItem>
                    <PaginationItem><PaginationNext href="#navigation" /></PaginationItem>
                  </PaginationContent>
                </Pagination>
              </Preview>
            </div>
          </div>
        </Section>

        <Section title="Feedback and status" description="Color communicates actual state. Persistent notices, temporary toasts, and progress each have one job.">
          <div className="grid gap-4">
            <Preview label="Status badges">
              <div className="flex flex-wrap gap-2">
                <Badge>Draft</Badge><Badge variant="success">Ready</Badge><Badge variant="warning">Needs review</Badge><Badge variant="info">In progress</Badge><Badge variant="destructive">Failed</Badge><Badge variant="otto-soft">Made with Otto</Badge>
              </div>
            </Preview>
            <Preview label="Persistent alerts">
              <div className="grid gap-3">
                <Alert variant="info"><Info /><AlertTitle>Update available</AlertTitle><AlertDescription>Review the latest version before publishing.</AlertDescription></Alert>
                <Alert variant="success"><CheckCircle2 /><AlertTitle>Changes saved</AlertTitle><AlertDescription>Your workspace is up to date.</AlertDescription></Alert>
                <Alert variant="warning"><CircleHelp /><AlertTitle>Approval needed</AlertTitle><AlertDescription>One item still needs a decision.</AlertDescription></Alert>
              </div>
            </Preview>
            <div className="grid gap-4 md:grid-cols-2">
              <Preview label="Progress and loading">
                <div className="grid gap-5">
                  <div><div className="mb-2 flex justify-between text-sm"><span>Uploading</span><span className="font-mono text-xs text-muted-foreground">68%</span></div><Progress value={68} /></div>
                  <div className="flex items-center gap-3 text-sm text-muted-foreground"><Spinner />Preparing preview…</div>
                  <div className="grid gap-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-4/5" /></div>
                </div>
              </Preview>
              <Preview label="Temporary toast">
                <div className="flex min-h-32 flex-col items-start justify-between gap-5">
                  <p className="text-sm leading-6 text-muted-foreground">Use a toast for brief confirmation that does not need to remain on the page.</p>
                  <Button variant="secondary" size="sm" onClick={() => toast.success("Campaign saved")}>Show toast</Button>
                </div>
              </Preview>
            </div>
            <Preview label="Empty state">
              <Empty className="border border-dashed border-border py-10">
                <EmptyHeader>
                  <EmptyMedia variant="icon"><Upload /></EmptyMedia>
                  <EmptyTitle>No assets yet</EmptyTitle>
                  <EmptyDescription>Add the first asset when you are ready.</EmptyDescription>
                </EmptyHeader>
                <EmptyContent><Button size="sm"><Plus data-icon="inline-start" />Add asset</Button></EmptyContent>
              </Empty>
            </Preview>
          </div>
        </Section>

        <Section title="Data and structure" description="Cards group related information; tables preserve comparison and scanability.">
          <div className="grid gap-4">
            <Preview label="Carousel · browsable media">
              <Carousel aria-label="Campaign concepts" className="mx-12">
                <CarouselContent>
                  {["Launch hero", "Product detail", "Customer proof"].map((title, index) => (
                    <CarouselItem key={title} className="sm:basis-1/2 lg:basis-1/3">
                      <Card>
                        <CardContent className="flex aspect-[4/3] flex-col justify-between p-5">
                          <span className="font-mono text-xs text-muted-foreground">0{index + 1}</span>
                          <span className="text-sm font-semibold">{title}</span>
                        </CardContent>
                      </Card>
                    </CarouselItem>
                  ))}
                </CarouselContent>
                <CarouselPrevious />
                <CarouselNext />
              </Carousel>
            </Preview>
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader><CardTitle>Campaign summary</CardTitle><CardDescription>A neutral container for related content.</CardDescription></CardHeader>
                <CardContent><div className="font-mono text-2xl font-semibold">RM 2,350</div><div className="mt-1 text-sm text-muted-foreground">Spend this month</div></CardContent>
                <CardFooter><Button variant="secondary" size="sm">View details</Button></CardFooter>
              </Card>
              <Card tone="otto">
                <CardHeader><CardTitle>Otto suggestion</CardTitle><CardDescription>Coral tint denotes Otto ownership, not urgency.</CardDescription></CardHeader>
                <CardContent className="text-sm leading-6">Tighten the headline before generating the next variation.</CardContent>
                <CardFooter><Button variant="otto-soft" size="sm"><Sparkles data-icon="inline-start" />Apply suggestion</Button></CardFooter>
              </Card>
            </div>
            <Preview label="People and ownership">
              <div className="flex flex-wrap items-center gap-6">
                <AvatarGroup>
                  <Avatar><AvatarFallback>WK</AvatarFallback><AvatarBadge><Check /></AvatarBadge></Avatar>
                  <Avatar><AvatarFallback>AN</AvatarFallback></Avatar>
                  <Avatar><AvatarFallback>SF</AvatarFallback></Avatar>
                  <AvatarGroupCount>+4</AvatarGroupCount>
                </AvatarGroup>
                <div className="text-sm"><div className="font-medium">7 collaborators</div><div className="text-muted-foreground">3 active now</div></div>
              </div>
            </Preview>
            <Preview label="Table">
              <Table>
                <TableHeader><TableRow><TableHead>Asset</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Updated</TableHead></TableRow></TableHeader>
                <TableBody>
                  <TableRow><TableCell className="font-medium">Launch hero</TableCell><TableCell><Badge variant="success">Ready</Badge></TableCell><TableCell className="text-right font-mono text-xs">2 min ago</TableCell></TableRow>
                  <TableRow><TableCell className="font-medium">Product story</TableCell><TableCell><Badge variant="warning">Review</Badge></TableCell><TableCell className="text-right font-mono text-xs">18 min ago</TableCell></TableRow>
                </TableBody>
              </Table>
            </Preview>
          </div>
        </Section>

        <Section title="Overlays" description="Menus hold actions, popovers hold supporting controls, and modal surfaces interrupt only when needed.">
          <Preview label="Interactive overlay family">
            <div className="flex flex-wrap gap-3">
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="secondary"><MoreHorizontal data-icon="inline-start" />Menu <ChevronDown data-icon="inline-end" /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Asset actions</DropdownMenuLabel>
                    <DropdownMenuItem><Mail />Share</DropdownMenuItem>
                    <DropdownMenuItem><Settings2 />Settings</DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive"><Trash2 />Delete</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Popover>
                <PopoverTrigger asChild><Button variant="secondary"><Settings2 data-icon="inline-start" />Popover</Button></PopoverTrigger>
                <PopoverContent align="start">
                  <div className="text-sm font-semibold">Display options</div>
                  <p className="mt-1 text-sm leading-5 text-muted-foreground">Supporting controls stay anchored to their trigger.</p>
                  <label className="mt-4 flex items-center justify-between gap-4 text-sm"><span>Compact rows</span><Switch /></label>
                </PopoverContent>
              </Popover>

              <Dialog>
                <DialogTrigger asChild><Button variant="secondary">Dialog</Button></DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Rename campaign</DialogTitle><DialogDescription>Change the team-facing name for this campaign.</DialogDescription></DialogHeader>
                  <Field><FieldLabel htmlFor="campaign-name">Name</FieldLabel><Input id="campaign-name" defaultValue="Summer launch" /></Field>
                  <DialogFooter><Button size="sm">Save name</Button></DialogFooter>
                </DialogContent>
              </Dialog>

              <Sheet>
                <SheetTrigger asChild><Button variant="secondary">Sheet</Button></SheetTrigger>
                <SheetContent>
                  <SheetHeader><SheetTitle>Asset details</SheetTitle><SheetDescription>Review supporting information without losing page context.</SheetDescription></SheetHeader>
                  <div className="grid gap-4 border-t border-border pt-5 text-sm"><div className="flex justify-between gap-4"><span className="text-muted-foreground">Owner</span><span>Winnin</span></div><div className="flex justify-between gap-4"><span className="text-muted-foreground">Status</span><Badge variant="success">Ready</Badge></div></div>
                  <SheetFooter><Button size="sm">Open asset</Button></SheetFooter>
                </SheetContent>
              </Sheet>

              <AlertDialog>
                <AlertDialogTrigger asChild><Button variant="destructive-secondary">Alert dialog</Button></AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader><AlertDialogTitle>Delete this draft?</AlertDialogTitle><AlertDialogDescription>This removes the draft from the workspace. This action cannot be undone.</AlertDialogDescription></AlertDialogHeader>
                  <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive">Delete draft</AlertDialogAction></AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <Tooltip>
                <TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label="More information"><Ellipsis /></Button></TooltipTrigger>
                <TooltipContent>More information</TooltipContent>
              </Tooltip>
            </div>
          </Preview>
        </Section>

        <footer className="flex flex-col items-start justify-between gap-5 border-t border-border py-10 text-sm leading-6 text-muted-foreground sm:flex-row sm:items-center">
          <p>Phase 1B ends here. The closure checklist decides what is ready, deferred, or not applicable.</p>
          <a
            href="/design-system/checklist"
            className="inline-flex shrink-0 items-center gap-2 font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
          >
            Review readiness
            <ArrowRight className="size-4" aria-hidden="true" />
          </a>
        </footer>
      </main>
    </TooltipProvider>
  )
}
