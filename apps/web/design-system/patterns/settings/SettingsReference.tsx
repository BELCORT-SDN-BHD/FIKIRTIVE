"use client"

import Image from "next/image"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import * as React from "react"
import {
  AlertTriangle,
  Check,
  ChevronRight,
  CircleUserRound,
  Coins,
  CreditCard,
  HeartPulse,
  LockKeyhole,
  Plus,
  ReceiptText,
  Settings2,
  Unplug,
  UserRound,
} from "lucide-react"

import { SHELL_ROUTES } from "@fikirtive/core/navigation"
import { OttoPanelFlowReference } from "@/components/otto/panel/OttoPanelFlowReference"
import { ProductPatternShellFrame } from "@/design-system/patterns/application-shell/ProductPatternShellFrame"
import { REVIEW_ACCOUNT } from "@/design-system/patterns/application-shell/review-account"
import { Alert, AlertDescription, AlertTitle } from "@/design-system/primitives/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/design-system/primitives/alert-dialog"
import { Button, buttonVariants } from "@/design-system/primitives/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/design-system/primitives/dialog"
import { Input } from "@/design-system/primitives/input"
import { Label } from "@/design-system/primitives/label"
import { toast } from "@/design-system/primitives/toast"
import { cn } from "@/lib/utils"

import {
  AVAILABLE_CONNECTION_FIXTURES,
  SETTINGS_BILLING_FIXTURE,
  SETTINGS_CONNECTION_FIXTURES,
} from "./fixtures"
import {
  isSettingsSectionKey,
  SETTINGS_SECTIONS,
  type SettingsSectionKey,
  type WorkspaceConnection,
} from "./model"
import { settingsSectionReviewHref } from "./review-links"

const SECTION_COPY: Record<SettingsSectionKey, { title: string; description: string }> = {
  profile: {
    title: "Profile",
    description: "Manage the personal details attached to your account.",
  },
  general: {
    title: "General",
    description: "Manage the name and identity of this workspace.",
  },
  connections: {
    title: "Connections",
    description: "Connect the services Fikirtive uses across this workspace.",
  },
  billing: {
    title: "Billing & credits",
    description: "Review your plan, credit balances, payment method and invoices.",
  },
}

const INVOICE_FIXTURES = [
  { id: "INV-2026-08", date: "31 Aug 2026", amount: "RM 149.00", status: "Paid" },
  { id: "INV-2026-07", date: "31 Jul 2026", amount: "RM 149.00", status: "Paid" },
  { id: "INV-2026-06", date: "30 Jun 2026", amount: "RM 149.00", status: "Paid" },
] as const

const CREDIT_USAGE_FIXTURES = [
  { id: "usage-1", label: "Four product image directions", date: "31 Aug 2026", credits: "−16" },
  { id: "usage-2", label: "Six-second launch video", date: "30 Aug 2026", credits: "−20" },
  { id: "usage-3", label: "Product background variation", date: "29 Aug 2026", credits: "−4" },
] as const

function SettingsSectionNav({
  section,
  selectedConnectionId,
}: {
  section: SettingsSectionKey
  selectedConnectionId?: string
}) {
  return (
    <nav className="w-[220px] shrink-0 border-r border-border bg-background px-4 py-6" aria-label="Settings sections">
      {(["Personal", "Workspace"] as const).map((scope, scopeIndex) => (
        <div key={scope} className={cn(scopeIndex > 0 && "mt-7 border-t border-border pt-6")}>
          <p className="mb-2 px-2 text-xs font-semibold text-foreground">{scope}</p>
          <div className="space-y-1">
            {SETTINGS_SECTIONS.filter((item) => item.scope === scope).map((item) => {
              const active = section === item.key
              const Icon = item.key === "profile" ? CircleUserRound : item.key === "general" ? Settings2 : item.key === "connections" ? Unplug : CreditCard
              return (
                <Link
                  key={item.key}
                  href={settingsSectionReviewHref(
                    item.key,
                    item.key === "connections" ? selectedConnectionId : undefined,
                  )}
                  scroll={false}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    buttonVariants({ variant: "ghost", motion: "instant" }),
                    "h-10 w-full justify-start px-2.5 font-medium text-muted-foreground",
                    active && "bg-secondary text-foreground aria-selected:bg-secondary",
                  )}
                >
                  <Icon aria-hidden />
                  {item.label}
                </Link>
              )
            })}
          </div>
        </div>
      ))}
    </nav>
  )
}

function SessionSaved({ visible }: { visible: boolean }) {
  if (!visible) return null
  return (
    <span role="status" className="inline-flex items-center gap-1.5 text-sm font-medium text-success">
      <Check className="size-4" aria-hidden />
      Saved for this session
    </span>
  )
}

function ProfileContent() {
  const [displayName, setDisplayName] = React.useState<string>(REVIEW_ACCOUNT.displayName)
  const [saved, setSaved] = React.useState(false)

  return (
    <form
      className="mx-auto w-full max-w-2xl space-y-7 py-8"
      onSubmit={(event) => {
        event.preventDefault()
        setSaved(true)
        toast.success("Profile saved in this review session.")
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="profile-name">Display name</Label>
        <Input id="profile-name" value={displayName} onChange={(event) => { setDisplayName(event.target.value); setSaved(false) }} />
        <p className="text-sm text-muted-foreground">This is how your name appears across Fikirtive.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="profile-email">Email</Label>
        <Input id="profile-email" value={REVIEW_ACCOUNT.email} disabled />
        <p className="text-sm text-muted-foreground">Email changes are managed by the account identity service.</p>
      </div>
      <div className="flex items-center gap-4 border-t border-border pt-5">
        <Button type="submit" size="sm" disabled={!displayName.trim()}>Save changes</Button>
        <SessionSaved visible={saved} />
      </div>
    </form>
  )
}

function GeneralContent() {
  const [workspaceName, setWorkspaceName] = React.useState("Fikirtive Labs Sdn Bhd")
  const [saved, setSaved] = React.useState(false)

  return (
    <form
      className="mx-auto w-full max-w-2xl space-y-7 py-8"
      onSubmit={(event) => {
        event.preventDefault()
        setSaved(true)
        toast.success("Workspace name saved in this review session.")
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="workspace-name">Workspace name</Label>
        <Input id="workspace-name" value={workspaceName} onChange={(event) => { setWorkspaceName(event.target.value); setSaved(false) }} />
        <p className="text-sm text-muted-foreground">This name identifies the workspace inside Fikirtive. It does not replace your Brand context.</p>
      </div>
      <div className="flex items-center gap-4 border-t border-border pt-5">
        <Button type="submit" size="sm" disabled={!workspaceName.trim()}>Save changes</Button>
        <SessionSaved visible={saved} />
      </div>
    </form>
  )
}

function ConnectionLogo({ connection, size = 44 }: { connection: WorkspaceConnection; size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-[10px] border border-border bg-card" style={{ width: size, height: size }}>
      <Image src={connection.icon} alt="" width={Math.round(size * 0.58)} height={Math.round(size * 0.58)} aria-hidden />
    </span>
  )
}

function HealthLabel({ health }: { health: WorkspaceConnection["health"] }) {
  const healthy = health === "Healthy"
  return (
    <span className={cn("inline-flex items-center gap-2 text-sm", healthy ? "text-success" : "text-warning-soft-foreground")}>
      <span className={cn("size-2 rounded-full", healthy ? "bg-success" : "bg-warning")} aria-hidden />
      {health}
    </span>
  )
}

function AddConnectionDialog({
  open,
  onOpenChange,
  available,
  onConnect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  available: readonly WorkspaceConnection[]
  onConnect: (connection: WorkspaceConnection) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add connection</DialogTitle>
          <DialogDescription>Choose a service to make its approved data available across this workspace.</DialogDescription>
        </DialogHeader>
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-border">
          {available.length ? available.map((connection) => (
            <div key={connection.id} className="flex items-center gap-3 px-4 py-3.5">
              <ConnectionLogo connection={connection} size={38} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{connection.name}</p>
                <p className="text-xs text-muted-foreground">{connection.availableData}</p>
              </div>
              <Button size="sm" onClick={() => onConnect(connection)}>Connect</Button>
            </div>
          )) : (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">All available fixture services are connected.</p>
          )}
        </div>
        <p className="text-xs text-muted-foreground">Preview only. No external authorization is started.</p>
      </DialogContent>
    </Dialog>
  )
}

function ChangeAccountDialog({
  connection,
  open,
  onOpenChange,
  onSave,
}: {
  connection: WorkspaceConnection
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (identity: string) => void
}) {
  const [identity, setIdentity] = React.useState(connection.identity)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change connected account</DialogTitle>
          <DialogDescription>This changes the {connection.name} identity available to everyone in this workspace.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="connection-identity">Connected as</Label>
          <Input id="connection-identity" value={identity} onChange={(event) => setIdentity(event.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" disabled={!identity.trim()} onClick={() => onSave(identity.trim())}>Save account</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ConnectionsContent({
  connections,
  selectedId,
  onReconnect,
  onChangeAccount,
  onDisconnect,
}: {
  connections: readonly WorkspaceConnection[]
  selectedId?: string
  onReconnect: (id: string) => void
  onChangeAccount: (id: string, identity: string) => void
  onDisconnect: (id: string) => void
}) {
  const selected = connections.find((connection) => connection.id === selectedId) ?? connections[0]
  const [changeAccountOpen, setChangeAccountOpen] = React.useState(false)
  const [accessOpen, setAccessOpen] = React.useState(false)
  const [disconnectOpen, setDisconnectOpen] = React.useState(false)

  if (!selected) {
    return <div className="grid flex-1 place-items-center p-8 text-sm text-muted-foreground">No services are connected yet.</div>
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[360px_minmax(0,1fr)]">
      <section className="border-r border-border px-4 py-5" aria-label="Connected services">
        <p className="mb-3 px-2 text-xs font-semibold text-muted-foreground">Connections</p>
        <div className="space-y-1">
          {connections.map((connection) => {
            const active = connection.id === selected.id
            return (
              <Link
                key={connection.id}
                href={settingsSectionReviewHref("connections", connection.id)}
                scroll={false}
                aria-current={active ? "page" : undefined}
                className={cn(
                  buttonVariants({ variant: "ghost", motion: "instant" }),
                  "h-auto w-full justify-start rounded-lg border border-transparent px-3 py-3 text-left font-normal",
                  active && "border-foreground/70 bg-card shadow-xs",
                )}
              >
                <ConnectionLogo connection={connection} size={40} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{connection.name}</span>
                  <span className="mt-1 block"><HealthLabel health={connection.health} /></span>
                </span>
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              </Link>
            )
          })}
        </div>
      </section>

      <section className="min-w-0 overflow-y-auto px-8 py-7" aria-labelledby="connection-detail-title">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-start gap-4 pb-7">
            <ConnectionLogo connection={selected} size={52} />
            <div>
              <h2 id="connection-detail-title" className="text-xl font-semibold tracking-[-0.025em]">{selected.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{selected.identity}</p>
              <div className="mt-2"><HealthLabel health={selected.health} /></div>
            </div>
          </div>

          <div className="border-t border-border">
            <div className="flex items-start gap-4 border-b border-border py-6">
              <span className="grid size-8 place-items-center"><UserRound className="size-5" aria-hidden /></span>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold">Connected account</h3>
                <p className="mt-2 text-sm">{selected.identity}</p>
                <p className="mt-1 text-sm text-muted-foreground">{selected.accountDetail}</p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setChangeAccountOpen(true)}>Change account</Button>
            </div>

            <div className="flex items-start gap-4 border-b border-border py-6">
              <span className="grid size-8 place-items-center"><LockKeyhole className="size-5" aria-hidden /></span>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold">Workspace access</h3>
                <p className="mt-2 text-sm">{selected.access}</p>
                <p className="mt-1 text-sm text-muted-foreground">Fikirtive only uses the data needed for approved product features.</p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setAccessOpen(true)}>Manage access</Button>
            </div>

            <div className="flex items-start gap-4 py-6">
              <span className="grid size-8 place-items-center"><HeartPulse className="size-5" aria-hidden /></span>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold">Connection health</h3>
                {selected.health === "Reconnect needed" ? (
                  <Alert variant="warning" className="mt-4">
                    <AlertTriangle aria-hidden />
                    <AlertTitle>We haven&apos;t synced data since {selected.lastSync}.</AlertTitle>
                    <AlertDescription>Some details may be out of date until this connection is restored.</AlertDescription>
                  </Alert>
                ) : null}
                <dl className="mt-5 space-y-3 text-sm">
                  <div className="flex justify-between gap-6"><dt className="text-muted-foreground">Last successful sync</dt><dd className="text-right">{selected.lastSync}</dd></div>
                  <div className="flex justify-between gap-6"><dt className="text-muted-foreground">Data available</dt><dd className="text-right">{selected.availableData}</dd></div>
                  <div className="flex justify-between gap-6"><dt className="text-muted-foreground">Status</dt><dd><HealthLabel health={selected.health} /></dd></div>
                </dl>
                <div className="mt-6 flex items-center gap-3">
                  {selected.health === "Reconnect needed" ? <Button size="sm" onClick={() => onReconnect(selected.id)}>Reconnect {selected.name}</Button> : null}
                  <Button variant="link" size="sm" onClick={() => setDisconnectOpen(true)}>Disconnect</Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <ChangeAccountDialog
          key={selected.id}
          connection={selected}
          open={changeAccountOpen}
          onOpenChange={setChangeAccountOpen}
          onSave={(identity) => {
            onChangeAccount(selected.id, identity)
            setChangeAccountOpen(false)
            toast.success("Connected account updated for this review session.")
          }}
        />
        <Dialog open={accessOpen} onOpenChange={setAccessOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Workspace access</DialogTitle>
              <DialogDescription>{selected.name} is available to everyone in this workspace.</DialogDescription>
            </DialogHeader>
            <div className="rounded-[var(--radius-card)] border border-border bg-secondary/45 px-4 py-3.5">
              <p className="text-sm font-semibold">Everyone in this workspace</p>
              <p className="mt-1 text-sm text-muted-foreground">More granular connection permissions are not part of the beta.</p>
            </div>
            <DialogFooter>
              <Button size="sm" onClick={() => setAccessOpen(false)}>Done</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Disconnect {selected.name}?</AlertDialogTitle>
              <AlertDialogDescription>This removes the connection from the current review session. No external account is changed.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => {
                  setDisconnectOpen(false)
                  onDisconnect(selected.id)
                }}
              >
                Disconnect
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>
    </div>
  )
}

function BillingContent({
  purchasedCredits,
  onAddCredits,
}: {
  purchasedCredits: number
  onAddCredits: (amount: number) => void
}) {
  const [creditsOpen, setCreditsOpen] = React.useState(false)
  const [paymentOpen, setPaymentOpen] = React.useState(false)
  const [invoicesOpen, setInvoicesOpen] = React.useState(false)
  const [usageOpen, setUsageOpen] = React.useState(false)
  const [paymentMethod, setPaymentMethod] = React.useState("Visa ending in 4242")

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 py-8">
      <section>
        <div className="flex items-start gap-3">
          <CreditCard className="mt-0.5 size-5" aria-hidden />
          <div><h2 className="text-base font-semibold">Plan & payment</h2><p className="mt-1 text-sm text-muted-foreground">Founder plan · billed monthly</p></div>
        </div>
        <div className="mt-4 divide-y divide-border rounded-[var(--radius-card)] border border-border">
          <div className="flex items-center justify-between gap-4 px-4 py-4"><div><p className="text-sm font-medium">Payment method</p><p className="mt-1 text-xs text-muted-foreground">{paymentMethod}</p></div><Button variant="secondary" size="sm" onClick={() => setPaymentOpen(true)}>Change</Button></div>
          <div className="flex items-center justify-between gap-4 px-4 py-4"><div><p className="text-sm font-medium">Invoices</p><p className="mt-1 text-xs text-muted-foreground">View previous workspace invoices</p></div><Button variant="ghost" size="sm" onClick={() => setInvoicesOpen(true)}><ReceiptText aria-hidden />View invoices</Button></div>
        </div>
      </section>

      <section>
        <div className="flex items-start gap-3">
          <Coins className="mt-0.5 size-5" aria-hidden />
          <div className="min-w-0 flex-1"><h2 className="text-base font-semibold">Credits</h2><p className="mt-1 text-sm text-muted-foreground">Monthly allowance and purchased credits are tracked separately.</p></div>
          <Button size="sm" onClick={() => setCreditsOpen(true)}><Plus aria-hidden />Add credits</Button>
        </div>
        <div className="mt-4 divide-y divide-border rounded-[var(--radius-card)] border border-border">
          <div className="grid grid-cols-2 gap-6 px-4 py-5"><div><p className="text-xs font-medium text-muted-foreground">Monthly credits</p><p className="mt-2 text-xl font-semibold">{SETTINGS_BILLING_FIXTURE.monthlyCredits.toLocaleString()}</p><p className="mt-1 text-xs text-muted-foreground">Resets 30 Sep 2026</p></div><div className="border-l border-border pl-6"><p className="text-xs font-medium text-muted-foreground">Purchased credits</p><p className="mt-2 text-xl font-semibold">{purchasedCredits.toLocaleString()}</p><p className="mt-1 text-xs text-muted-foreground">No expiry in this fixture</p></div></div>
          <div className="flex items-center justify-between gap-4 px-4 py-4"><div><p className="text-sm font-medium">Usage history</p><p className="mt-1 text-xs text-muted-foreground">See what this workspace used credits for</p></div><Button variant="ghost" size="sm" onClick={() => setUsageOpen(true)}>View usage <ChevronRight aria-hidden /></Button></div>
        </div>
      </section>

      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Change payment method</DialogTitle><DialogDescription>Choose the payment method used by this review session. No payment details are transmitted.</DialogDescription></DialogHeader>
          <div className="space-y-2">
            {["Visa ending in 4242", "Mastercard ending in 4444"].map((method) => (
              <Button
                key={method}
                variant={paymentMethod === method ? "default" : "secondary"}
                className="w-full justify-between"
                onClick={() => {
                  setPaymentMethod(method)
                  setPaymentOpen(false)
                  toast.success("Payment method updated for this review session.")
                }}
              >
                {method}
                {paymentMethod === method ? <Check aria-hidden /> : null}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={invoicesOpen} onOpenChange={setInvoicesOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Invoices</DialogTitle><DialogDescription>Recent workspace invoices for this review fixture.</DialogDescription></DialogHeader>
          <div className="divide-y divide-border overflow-hidden rounded-[var(--radius-card)] border border-border">
            {INVOICE_FIXTURES.map((invoice) => (
              <div key={invoice.id} className="grid grid-cols-[1fr_auto] gap-x-4 px-4 py-3.5">
                <div><p className="text-sm font-semibold">{invoice.id}</p><p className="mt-1 text-xs text-muted-foreground">{invoice.date}</p></div>
                <div className="text-right"><p className="text-sm font-medium">{invoice.amount}</p><p className="mt-1 text-xs text-success">{invoice.status}</p></div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={usageOpen} onOpenChange={setUsageOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Credit usage</DialogTitle><DialogDescription>Recent generation costs in this review fixture.</DialogDescription></DialogHeader>
          <div className="divide-y divide-border overflow-hidden rounded-[var(--radius-card)] border border-border">
            {CREDIT_USAGE_FIXTURES.map((entry) => (
              <div key={entry.id} className="flex items-start justify-between gap-4 px-4 py-3.5">
                <div><p className="text-sm font-semibold">{entry.label}</p><p className="mt-1 text-xs text-muted-foreground">{entry.date}</p></div>
                <p className="text-sm font-semibold tabular-nums">{entry.credits}</p>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={creditsOpen} onOpenChange={setCreditsOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add credits</DialogTitle><DialogDescription>Choose a fixture amount. No payment is processed.</DialogDescription></DialogHeader>
          <div className="grid grid-cols-3 gap-2">
            {[100, 250, 500].map((amount) => <Button key={amount} variant="secondary" onClick={() => { onAddCredits(amount); setCreditsOpen(false); toast.success(`${amount} preview credits added for this session.`) }}>{amount} credits</Button>)}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function SettingsReference({
  initialSection = "general",
  initialConnectionId,
}: {
  initialSection?: SettingsSectionKey
  initialConnectionId?: string
}) {
  const router = useRouter()
  const routeSearchParams = useSearchParams()
  const [connections, setConnections] = React.useState<WorkspaceConnection[]>(() => [...SETTINGS_CONNECTION_FIXTURES])
  const [purchasedCredits, setPurchasedCredits] = React.useState<number>(SETTINGS_BILLING_FIXTURE.purchasedCredits)
  const [addConnectionOpen, setAddConnectionOpen] = React.useState(false)
  const routeSection = routeSearchParams.get("section") ?? undefined
  const section = isSettingsSectionKey(routeSection) ? routeSection : initialSection
  const requestedConnectionId = routeSearchParams.get("connection") ?? initialConnectionId ?? "shopify"
  const selectedConnectionId = connections.some((connection) => connection.id === requestedConnectionId)
    ? requestedConnectionId
    : connections[0]?.id

  function updateConnection(id: string, patch: Partial<WorkspaceConnection>) {
    setConnections((current) => current.map((connection) => connection.id === id ? { ...connection, ...patch } : connection))
  }

  const availableConnections = AVAILABLE_CONNECTION_FIXTURES.filter((candidate) => !connections.some((connection) => connection.id === candidate.id))
  const header = SECTION_COPY[section]

  return (
    <div className="gb min-h-dvh bg-background text-foreground">
      <OttoPanelFlowReference founderName={REVIEW_ACCOUNT.displayName} recommendedPrompt={`Help me with my ${header.title.toLowerCase()} settings.`}>
        <ProductPatternShellFrame
          pathname={SHELL_ROUTES.preferences}
          topBarLabel="Settings"
          account={{
            ...REVIEW_ACCOUNT,
            balance: SETTINGS_BILLING_FIXTURE.monthlyCredits + purchasedCredits,
          }}
        >
          <main className="flex h-[calc(100dvh-2.75rem)] min-w-0 flex-col overflow-hidden bg-background">
            <header className="shrink-0 border-b border-border px-7 py-6">
              <div className="flex items-start justify-between gap-6">
                <div>
                  <h1 className="text-2xl font-semibold tracking-[-0.03em]">{header.title}</h1>
                  <p className="mt-1 text-sm text-muted-foreground">{header.description}</p>
                  <p className="mt-3 inline-flex items-center gap-2 text-sm text-muted-foreground">
                    <CircleUserRound className="size-4" aria-hidden />
                    {section === "profile" ? "Changes here affect only your account." : "Changes affect everyone in this workspace."}
                  </p>
                </div>
                {section === "connections" ? <Button size="sm" onClick={() => setAddConnectionOpen(true)}><Plus aria-hidden />Add connection</Button> : null}
              </div>
            </header>

            <div className="flex min-h-0 flex-1">
              <SettingsSectionNav section={section} selectedConnectionId={selectedConnectionId} />
              <div key={section} className="flex min-w-0 flex-1 overflow-y-auto px-7">
                {section === "profile" ? <ProfileContent /> : null}
                {section === "general" ? <GeneralContent /> : null}
                {section === "connections" ? (
                  <ConnectionsContent
                    connections={connections}
                    selectedId={selectedConnectionId}
                    onReconnect={(id) => {
                      updateConnection(id, { health: "Healthy", lastSync: "Just now" })
                      toast.success("Connection restored for this review session.")
                    }}
                    onChangeAccount={(id, identity) => updateConnection(id, { identity })}
                    onDisconnect={(id) => {
                      const next = connections.find((connection) => connection.id !== id)
                      setConnections((current) => current.filter((connection) => connection.id !== id))
                      router.replace(settingsSectionReviewHref("connections", next?.id), { scroll: false })
                      toast.success("Connection removed from this review session.")
                    }}
                  />
                ) : null}
                {section === "billing" ? (
                  <BillingContent
                    purchasedCredits={purchasedCredits}
                    onAddCredits={(amount) => setPurchasedCredits((current) => current + amount)}
                  />
                ) : null}
              </div>
            </div>
          </main>
        </ProductPatternShellFrame>
        <AddConnectionDialog
          open={addConnectionOpen}
          onOpenChange={setAddConnectionOpen}
          available={availableConnections}
          onConnect={(connection) => {
            const connected = { ...connection, identity: "Kedai Kopi", lastSync: "Just now" }
            setConnections((current) => [...current, connected])
            router.push(settingsSectionReviewHref("connections", connected.id), { scroll: false })
            setAddConnectionOpen(false)
            toast.success(`${connected.name} added for this review session.`)
          }}
        />
      </OttoPanelFlowReference>
    </div>
  )
}
