"use client";
import type { SettingsSection } from "./types";
import type { AccountInfo } from "@/lib/account-actions";
import type { OwnerSettings } from "@/lib/owner-settings";
import { setOwnerSetting } from "@/lib/owner-settings-actions";
import { setAdsAutonomy } from "@/lib/otto-client-actions";
import { creditsLabel, formatCredits, SPEND_CAP_HINT } from "@/lib/credit-format";
import { CREDIT_PACKS_UNREADABLE_MESSAGE, NO_CREDIT_PACKS_MESSAGE } from "@/lib/exits";
import { SupportExit } from "@/components/exits/Exits";
import type { CreditPackShelf } from "@/lib/billing-actions";
import { autoPublishHint, canAutoPublish } from "@/lib/auto-publish-gate";
import { isConnectableChannel } from "@/lib/channels/channel-meta";
import type { ConnectionBlocker } from "@fikirtive/core/schedule-draft";
import { SHELL_ROUTES } from "@fikirtive/core/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type ChannelState = {
  id: string;
  label: string;
  status: "connected" | "needs_reconnect" | "not_connected";
  targets: string[];
  /** Connected, but not usable right now (#741 r5 P1). Rendered with the SAME words Schedule
   *  uses for the same fact — see CONNECTION_BLOCKER_COPY in @fikirtive/core. */
  blocker?: ConnectionBlocker | null;
  connectUrl: string;
};

export function buildSettingsSections(args: {
  account: AccountInfo;
  settings: OwnerSettings;
  channels: ChannelState[];
  shelf: CreditPackShelf;
  adsAutonomy: "ASK" | "AUTO";
  canPublish: boolean;
  onDeleteAccountRequest: () => void;
}): SettingsSection[] {
  const { account, settings, channels, shelf, adsAutonomy, canPublish, onDeleteAccountRequest } = args;
  const canChangeAdsAutonomy = channels.some((c) => c.status === "connected");
  const connectedChannelIds = channels.filter((c) => c.status === "connected").map((c) => c.id);
  const autoPublishAvailable = canAutoPublish(connectedChannelIds, canPublish);

  const toggle =
    (k: keyof OwnerSettings) =>
    (v: boolean) => setOwnerSetting(k, v as never);

  const num =
    (k: keyof OwnerSettings) =>
    (v: number) => setOwnerSetting(k, v as never);

  // "profile" was removed here (#513 A组返工 item 2) — it duplicated the global
  // nav's Profile page (identity/email/workspace, plus Sign out which now lives
  // once in the nav's identity menu). "billing" is KEPT past the #520 merge with
  // #516: its balance/Top-up field is still required by decision③'s own test
  // (apps/web/lib/__tests__/account-settings.test.ts — "billing top-up (decision
  // ③)"), and its ledger field keeps a short account.recent preview beside the
  // controls; the standalone /billing page now owns the complete spend history.
  // #516's real improvements here (explicit save+confirm lives in
  // SettingsPage's NumberField, unaffected by this file; the honest spend-cap
  // copy right below was already shared going into the merge; formatCredits'
  // thousands formatting and the per-task detail/atLabel ledger rows below are
  // this section's own content) would be silently deleted, not just de-duplicated,
  // if this section were dropped too. Tradeoff recorded in PR #517's description.
  const sections: SettingsSection[] = [
    {
      id: "billing",
      title: "Billing and credits",
      subtitle: "Your balance and where credits went.",
      fields: [
        {
          kind: "custom",
          id: "balance",
          render: () => (
            <div className="flex w-full flex-col justify-between gap-4 sm:flex-row sm:items-start">
              <div className="flex flex-col gap-2">
                <div className="text-sm font-medium text-muted-foreground">Credit balance</div>
                <div className="font-mono text-3xl font-semibold tracking-tight tabular-nums">
                  {creditsLabel(account.balance)}
                </div>
                {account.reserved > 0 ? (
                  <Badge variant="warning">{creditsLabel(account.reserved)} held</Badge>
                ) : null}
              </div>
              {/* Single top-up entry (decision ③): one button into the unified /billing
                  page, which lists every pack with its credits AND price. No more than-one
                  price-only "Buy" button per pack duplicated here. */}
              {"unreadable" in shelf ? (
                // #786 — the catalogue read failed, so we know neither that there are packs
                // nor that there are none. Same sentence /billing shows for the same state,
                // and no human exit: a retryable error does not get one.
                <span className="max-w-xs text-sm text-muted-foreground">{CREDIT_PACKS_UNREADABLE_MESSAGE}</span>
              ) : shelf.packs.length > 0 ? (
                <Button asChild size="sm" variant="outline"><a href="/billing">Top up</a></Button>
              ) : (
                // #687 — the same sentence /billing shows for the same state, plus the one
                // exit that is actually open. An empty shelf must not be a full stop for a
                // merchant who has already decided to pay.
                <span className="max-w-xs text-sm text-muted-foreground">
                  {NO_CREDIT_PACKS_MESSAGE} <SupportExit subject="I want to buy credits" />
                </span>
              )}
            </div>
          ),
        },
        {
          kind: "custom",
          id: "ledger",
          render: () => (
            <div className="flex w-full flex-col gap-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium">Recent credit activity</div>
                  <div className="text-sm text-muted-foreground">The latest movements on this workspace.</div>
                </div>
                <Button asChild size="sm" variant="ghost"><a href="/billing">View all</a></Button>
              </div>
              {account.recent.length === 0 ? (
                <p className="text-sm text-muted-foreground">No credit activity yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Activity</TableHead>
                      <TableHead className="hidden sm:table-cell">Details</TableHead>
                      <TableHead className="hidden md:table-cell">Date</TableHead>
                      <TableHead className="text-right">Credits</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {account.recent.slice(0, 8).map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell className="font-medium">{entry.label}</TableCell>
                        <TableCell className="hidden max-w-sm whitespace-normal text-muted-foreground sm:table-cell">{entry.detail ?? "—"}</TableCell>
                        <TableCell className="hidden text-muted-foreground md:table-cell">{entry.atLabel}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {entry.delta > 0 ? <Badge variant="success">+{formatCredits(entry.delta)}</Badge> : formatCredits(entry.delta)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          ),
        },
      ],
    },
    {
      id: "connections",
      title: "Connections",
      subtitle:
        "Instagram, Facebook, X, and messaging channels — one page for all of them.",
      fields: [
        {
          kind: "custom",
          id: "manage",
          render: () => {
            // #694 — count only what a merchant can actually connect today. The registry also
            // carries X, which has no connect flow, so "2 of 3 connected" told a fully connected
            // merchant they were still one short.
            const connectable = channels.filter((c) => isConnectableChannel(c.id));
            const connectedCount = connectable.filter((c) => c.status === "connected").length;
            return (
              <div className="flex w-full flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div>
                  <div className="text-sm font-medium">Publishing channels</div>
                  <div className="mt-1"><Badge variant={connectedCount > 0 ? "success" : "outline"}>{connectedCount} of {connectable.length} connected</Badge></div>
                </div>
                <Button asChild size="sm" variant="outline"><a href={SHELL_ROUTES.connections}>Manage connections</a></Button>
              </div>
            );
          },
        },
      ],
    },
    {
      id: "otto",
      title: "Otto behavior",
      subtitle: "How much Otto does without asking you.",
      fields: [
        {
          kind: "toggle",
          id: "ads",
          label: "Ask before ad spend",
          hint: canChangeAdsAutonomy
            ? "When on, Otto checks with you before every ad change. When off (Auto), Otto may pause ads, lower budgets, and create paused draft campaigns in your ad account without asking you — anything that spends or goes live still asks you first."
            : "Connect Instagram or Facebook before changing ad-spend autonomy",
          value: adsAutonomy === "ASK",
          disabled: !canChangeAdsAutonomy,
          onToggle: (v) => setAdsAutonomy(v ? "ASK" : "AUTO"),
        },
        {
          kind: "toggle",
          id: "autopub",
          label: "Auto-publish posts",
          // #851 — the same authority the Schedule screen reads. This hand-written "publishes
          // automatically" line used to survive here whatever the product could actually do, so a
          // connected workspace kept reading a promise the Schedule screen had already withdrawn.
          hint: autoPublishHint(autoPublishAvailable),
          value: settings.autoPublish,
          disabled: !autoPublishAvailable,
          onToggle: toggle("autoPublish"),
        },
        {
          kind: "number",
          id: "cap",
          label: "Spend cap",
          // #524 — the sentence is true again. It was the original promise ("Otto pauses a
          // task over this many credits"), then #487's honest-copy pass had to retract it
          // because nothing read the setting. The cap is now enforced inside reserveCredits,
          // so this says what the charging path actually does — per single action, because
          // that is what is enforced; it is not a monthly budget.
          // 前端基线合并 FRONT-A1:这句话现在只有一份(lib/credit-format.ts 的 SPEND_CAP_HINT),
          // 商家真正看得到的那一份渲染在 app/billing/SpendCapCard.tsx。
          hint: SPEND_CAP_HINT,
          value: settings.spendCapCredits,
          unit: "credits",
          onSave: num("spendCapCredits"),
        },
      ],
    },
    // #791-2: the "Notifications · Email / In-app" section is gone. Both toggles wrote to
    // Organization.settings and nothing ever read them — there is no email sender and no
    // in-app notification channel in the product, so "on" and "off" did exactly the same
    // thing. It comes back when there is something to switch off.
    {
      id: "schedule",
      title: "Schedule defaults",
      fields: [
        {
          kind: "text",
          id: "tz",
          label: "Time zone",
          value: settings.timezone,
          readOnly: true,
        },
        {
          kind: "text",
          id: "times",
          label: "Default posting times",
          hint: "Comma-separated, e.g. 09:00,18:00",
          value: settings.defaultPostTimes,
          readOnly: true,
        },
      ],
    },
    {
      id: "danger",
      title: "Danger zone",
      danger: true,
      fields: [
        {
          kind: "action",
          id: "del",
          label: "Delete account",
          // #686 — "Contact us" used to be a bare span: the merchant was told to reach us
          // and given nothing to click. Same sentence, now a live way out.
          hint: (
            <>
              Hides your workspace.{" "}
              <SupportExit subject="Erase my workspace" label="Contact us" /> to fully erase.
            </>
          ),
          button: "Delete",
          tone: "danger",
          onClick: onDeleteAccountRequest,
        },
      ],
    },
  ];

  // Preferences should open on behavior, not on a duplicate billing surface. Billing stays
  // reachable here as a summary, while the full purchase and history workflow lives at /billing.
  const order = ["otto", "connections", "schedule", "billing", "danger"];
  const rank = (id: string) => {
    const index = order.indexOf(id);
    return index === -1 ? order.length : index;
  };
  return sections.sort((a, b) => rank(a.id) - rank(b.id));
}
