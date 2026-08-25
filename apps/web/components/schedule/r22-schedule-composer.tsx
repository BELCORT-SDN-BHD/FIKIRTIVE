"use client";
/* eslint-disable react-hooks/set-state-in-effect -- Non-production R22 fixtures restore browser-scoped drafts after hydration. */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SelectNative } from "@/components/ui/native-select";

import { Check, CircleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { StuffItem } from "@/lib/stuff-items";
import {
  approveScheduledPost,
  cancelScheduledPost,
  createScheduledPost,
  type ScheduledPostRow,
  updateScheduledPost,
} from "@/lib/schedule-actions";
import { CONNECTABLE_CHANNEL_META } from "@/lib/channels/channel-meta";
import type { ChannelId } from "@/lib/channels/types";
import {
  accountPicker,
  approvalFor,
  connectionBlockerStatus,
  isConnectedTarget,
  type ConnectedAccounts,
} from "@/lib/schedule-connections";
import { partsInTz } from "@/lib/schedule-view";
import { scopedR22FixtureKey } from "@/components/r22/r22-workspace-fixture";

type ComposerSeed = { mode: "new" } | { mode: "edit"; post: ScheduledPostRow };

const DEFAULT_TZ = "Asia/Kuala_Lumpur";
const TIMEZONES = [DEFAULT_TZ, "Asia/Singapore", "Asia/Jakarta", "Asia/Bangkok"];
const FIXTURE_ACTIVE_COMPOSER_KEY = "fikirtive.r22.schedule.composer.active.v1";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function tomorrowSeed(timezone: string): { date: string; time: string } {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const parts = partsInTz(tomorrow, timezone);
  return {
    date: `${parts.year}-${pad(parts.month + 1)}-${pad(parts.day)}`,
    time: "09:00",
  };
}

function seedFields(seed: ComposerSeed, fallbackTz: string, fixture = false) {
  if (seed.mode === "new") {
    const next = fixture ? { date: "2026-08-26", time: "09:00" } : tomorrowSeed(fallbackTz);
    return {
      channel: "instagram",
      caption: "",
      media: [] as string[],
      date: next.date,
      time: next.time,
      timezone: fallbackTz,
      firstComment: "",
      targetId: "",
    };
  }
  const post = seed.post;
  const parts = partsInTz(new Date(post.scheduledAt), post.scheduledTz);
  return {
    channel: post.channel === "facebook" ? "facebook" : "instagram",
    caption: post.caption,
    media: post.media.map((item) => item.generationId),
    date: `${parts.year}-${pad(parts.month + 1)}-${pad(parts.day)}`,
    time: `${pad(parts.hour)}:${pad(parts.minute)}`,
    timezone: post.scheduledTz,
    firstComment: post.firstComment ?? "",
    targetId: post.metaTargetId ?? "",
  };
}

type ComposerFields = ReturnType<typeof seedFields>;

function fixtureDraftKey(seed: ComposerSeed): string {
  return scopedR22FixtureKey(`fikirtive.r22.schedule.composer.${seed.mode === "new" ? "new" : seed.post.id}.v1`);
}

function clearFixtureDraft(seed: ComposerSeed) {
  try {
    window.sessionStorage.removeItem(fixtureDraftKey(seed));
    window.sessionStorage.removeItem(scopedR22FixtureKey(FIXTURE_ACTIVE_COMPOSER_KEY));
  } catch {
    // Fixture recovery is best effort only.
  }
}

function localToUtcIso(date: string, time: string, timezone: string): string | null {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if ([year, month, day, hour, minute].some((value) => !Number.isFinite(value))) return null;
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const parts = partsInTz(new Date(guess), timezone);
  const landed = Date.UTC(parts.year, parts.month, parts.day, parts.hour, parts.minute);
  return new Date(guess - (landed - guess)).toISOString();
}

export function R22ScheduleComposer({
  seed,
  accounts,
  stuffItems,
  timezone,
  fixture,
  fixtureOutcome = "success",
  onClose,
  onSaved,
  onFixtureUpsert,
  onFixtureCancel,
}: {
  seed: ComposerSeed;
  accounts: ConnectedAccounts;
  stuffItems: StuffItem[];
  timezone: string;
  fixture: boolean;
  fixtureOutcome?: "success" | "error" | "permission" | "unknown";
  onClose: () => void;
  onSaved: () => Promise<void>;
  onFixtureUpsert: (post: ScheduledPostRow) => void;
  onFixtureCancel: (id: string) => void;
}) {
  const initial = useMemo(() => seedFields(seed, timezone || DEFAULT_TZ, fixture), [fixture, seed, timezone]);
  const [channel, setChannel] = useState(initial.channel);
  const [caption, setCaption] = useState(initial.caption);
  const [selectedMedia, setSelectedMedia] = useState(initial.media);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [scheduledTz, setScheduledTz] = useState(initial.timezone);
  const [firstComment, setFirstComment] = useState(initial.firstComment);
  const [targetId, setTargetId] = useState(initial.targetId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restored, setRestored] = useState(!fixture);
  const [confirmAction, setConfirmAction] = useState<"discard" | "cancel-post" | null>(null);
  const [fixtureFailedOnce, setFixtureFailedOnce] = useState(false);

  const mediaChoices = stuffItems.filter(
    (item): item is StuffItem & { generationId: string; url: string } =>
      Boolean(item.generationId && item.url && (item.mediaKind === "image" || item.mediaKind === "video")),
  );
  const picker = accountPicker(accounts, channel);
  const editable = seed.mode === "new" || ["DRAFT", "SCHEDULED"].includes(seed.post.status);
  const approval = approvalFor(accounts, { channel, targetId, mediaCount: selectedMedia.length });
  const canApprove = editable && (fixture ? selectedMedia.length > 0 : approval.canApprove);
  const currentFields: ComposerFields = { channel, caption, media: selectedMedia, date, time, timezone: scheduledTz, firstComment, targetId };
  const dirty = JSON.stringify(currentFields) !== JSON.stringify(initial);

  useEffect(() => {
    if (!fixture) return;
    try {
      window.sessionStorage.setItem(scopedR22FixtureKey(FIXTURE_ACTIVE_COMPOSER_KEY), JSON.stringify(seed.mode === "new" ? { mode: "new" } : { mode: "edit", id: seed.post.id }));
      const raw = window.sessionStorage.getItem(fixtureDraftKey(seed));
      if (raw) {
        const saved = JSON.parse(raw) as Partial<ComposerFields>;
        if (saved.channel === "instagram" || saved.channel === "facebook") setChannel(saved.channel);
        if (typeof saved.caption === "string") setCaption(saved.caption);
        if (Array.isArray(saved.media)) setSelectedMedia(saved.media.filter((item): item is string => typeof item === "string"));
        if (typeof saved.date === "string") setDate(saved.date);
        if (typeof saved.time === "string") setTime(saved.time);
        if (typeof saved.timezone === "string") setScheduledTz(saved.timezone);
        if (typeof saved.firstComment === "string") setFirstComment(saved.firstComment);
        if (typeof saved.targetId === "string") setTargetId(saved.targetId);
      }
    } catch {
      // Ignore malformed fixture-only recovery data.
    }
    setRestored(true);
  }, [fixture, seed]);

  useEffect(() => {
    if (!fixture || !restored) return;
    try {
      window.sessionStorage.setItem(fixtureDraftKey(seed), JSON.stringify(currentFields));
    } catch {
      // A blocked storage API must not break the form.
    }
  }, [fixture, restored, seed, channel, caption, selectedMedia, date, time, scheduledTz, firstComment, targetId]);

  function changeChannel(next: ChannelId) {
    setChannel(next);
    if (!isConnectedTarget(accounts, next, targetId)) setTargetId("");
  }

  function toggleMedia(generationId: string) {
    setSelectedMedia((current) =>
      current.includes(generationId)
        ? current.filter((id) => id !== generationId)
        : [...current, generationId].slice(0, 10),
    );
  }

  async function persist(approve: boolean) {
    setError(null);
    const scheduledAt = localToUtcIso(date, time, scheduledTz);
    if (!scheduledAt) return setError("Pick a valid date and time.");
    if (!caption.trim()) return setError("A post needs a caption.");
    setBusy(true);
    try {
      if (fixture) {
        if (fixtureOutcome === "permission") {
          setError("Your current workspace permission does not allow this schedule change. Nothing was saved or approved.");
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 280));
        if ((fixtureOutcome === "error" || fixtureOutcome === "unknown") && !fixtureFailedOnce) {
          setFixtureFailedOnce(true);
          setError(fixtureOutcome === "unknown" ? "Schedule save outcome is unknown. Retry this same fixture action to reconcile it; do not start another." : "Schedule save was not confirmed. Nothing changed; retry this same fixture action safely.");
          return;
        }
        const now = new Date("2026-08-25T08:42:00.000Z");
        const post: ScheduledPostRow = {
          id: seed.mode === "edit" ? seed.post.id : `fixture-post-${date}-${time.replace(":", "")}-${channel}`,
          channel,
          caption: caption.trim(),
          scheduledAt: new Date(scheduledAt),
          scheduledTz,
          media: selectedMedia.map((generationId, position) => ({ generationId, position })),
          firstComment: channel === "instagram" && firstComment.trim() ? firstComment.trim() : null,
          metaTargetId: null,
          status: approve ? "SCHEDULED" : "DRAFT",
          publishMode: "reminder",
          source: "owner",
          approvedAt: approve ? now : null,
          lastError: null,
          updatedAt: now,
        };
        onFixtureUpsert(post);
        clearFixtureDraft(seed);
        onClose();
        return;
      }
      let id = seed.mode === "edit" ? seed.post.id : "";
      const input = {
        channel,
        caption,
        scheduledAt,
        scheduledTz,
        media: selectedMedia,
        firstComment: channel === "instagram" && firstComment.trim() ? firstComment : undefined,
        metaTargetId: targetId || undefined,
      };
      if (seed.mode === "new") {
        const result = await createScheduledPost(input);
        if ("error" in result) return setError(result.error);
        id = result.id;
      } else {
        const result = await updateScheduledPost(seed.post.id, {
          ...input,
          firstComment: channel === "instagram" && firstComment.trim() ? firstComment : null,
          metaTargetId: targetId || null,
        });
        if ("error" in result) return setError(result.error);
      }
      if (approve) {
        const result = await approveScheduledPost(id);
        if ("error" in result) return setError(result.error);
      }
      await onSaved();
      onClose();
    } catch {
      setError("Couldn't save that — please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelPost() {
    if (seed.mode !== "edit") return;
    setBusy(true);
    setError(null);
    if (fixture) {
      await new Promise((resolve) => window.setTimeout(resolve, 220));
      onFixtureCancel(seed.post.id);
      clearFixtureDraft(seed);
      setBusy(false);
      onClose();
      return;
    }
    const result = await cancelScheduledPost(seed.post.id);
    if ("error" in result) {
      setError(result.error);
      setBusy(false);
      return;
    }
    await onSaved();
    setBusy(false);
    onClose();
  }

  function closeComposer() {
    if (dirty) {
      setConfirmAction("discard");
      return;
    }
    if (fixture) clearFixtureDraft(seed);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) closeComposer(); }}>
      <DialogContent className="r22-schedule-composer">
        <DialogHeader>
          <DialogTitle>{seed.mode === "new" ? "New post" : "Post details"}</DialogTitle>
          <DialogDescription>
            Reuse media already in Library. Saving a draft costs 0 credits; approving schedules it for the chosen time.
          </DialogDescription>
        </DialogHeader>

        <div className="r22-composer-scroll">
          {fixture ? <p className="r22-composer-notice"><CircleAlert /> R22 fixture changes stay in this browser tab. No server action or publishing provider is called.</p> : null}

          <fieldset disabled={!editable || busy}>
            <legend>Channel</legend>
            <div className="r22-composer-segment" role="group" aria-label="Channel">
              {CONNECTABLE_CHANNEL_META.map((option) => (
                <Button unstyled type="button" key={option.id} className={channel === option.id ? "is-active" : ""} onClick={() => changeChannel(option.id)}>
                  {option.label}
                </Button>
              ))}
            </div>
          </fieldset>

          <label>
            <span>Account</span>
            {picker.phase === "checking" ? <p className="r22-composer-inline-state">Checking connected accounts…</p> : picker.phase === "unreadable" ? <p className="r22-composer-inline-state">Accounts could not be checked. Close and retry.</p> : picker.phase === "blocked" ? <p className="r22-composer-inline-state">{connectionBlockerStatus(picker.blocker)} Open Connections before approval.</p> : picker.phase === "unavailable" ? <p className="r22-composer-inline-state">This channel is not available for publishing.</p> : picker.phase === "none" ? <p className="r22-composer-inline-state">No account is connected. You can still save a draft.</p> : <SelectNative unstyled aria-label="Publishing account" value={targetId} disabled={!editable || busy} onChange={(event) => setTargetId(event.target.value)}><option value="">Choose an account…</option>{picker.options.map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}</SelectNative>}
          </label>

          <label>
            <span>Media · {selectedMedia.length}/10</span>
            {mediaChoices.length ? <div className="r22-composer-media">{mediaChoices.map((item) => { const selected = selectedMedia.includes(item.generationId); return <Button unstyled type="button" key={item.id} aria-pressed={selected} aria-label={`${selected ? "Remove" : "Add"} ${item.label}`} disabled={!editable || busy} onClick={() => toggleMedia(item.generationId)}>{item.mediaKind === "video" ? <video src={item.url} muted preload="metadata" /> : <img src={item.url} alt="" />}{selected ? <i><Check /></i> : null}</Button>; })}</div> : <p className="r22-composer-inline-state">No generated media is available yet. Make something on Canvas first.</p>}
          </label>

          <label>
            <span>Caption</span>
            <Textarea unstyled value={caption} disabled={!editable || busy} rows={4} placeholder="Write your caption…" onChange={(event) => setCaption(event.target.value)} />
          </label>

          {channel === "instagram" ? <label><span>First comment (optional)</span><Input unstyled value={firstComment} disabled={!editable || busy} placeholder="Hashtags or a link…" onChange={(event) => setFirstComment(event.target.value)} /></label> : null}

          <div className="r22-composer-date">
            <label><span>Date</span><Input unstyled type="date" value={date} disabled={!editable || busy} onChange={(event) => setDate(event.target.value)} /></label>
            <label><span>Time</span><Input unstyled type="time" value={time} disabled={!editable || busy} onChange={(event) => setTime(event.target.value)} /></label>
            <label><span>Time zone</span><SelectNative unstyled value={scheduledTz} disabled={!editable || busy} onChange={(event) => setScheduledTz(event.target.value)}>{TIMEZONES.map((value) => <option key={value} value={value}>{value.replace("_", " ")}</option>)}</SelectNative></label>
          </div>
        </div>

        {seed.mode === "edit" && seed.post.status === "NEEDS_ATTENTION" && seed.post.lastError ? <p className="r22-composer-error" role="status">Needs attention — {seed.post.lastError}</p> : null}
        {error ? <p className="r22-composer-error" role="alert">{error}</p> : null}
        {fixture ? <p className="r22-composer-blocker" role="status">No channel is connected. Approval holds this post in Schedule until one is connected.</p> : approval.blockers[0] ? <p className="r22-composer-blocker" role="status">{approval.blockers[0]}</p> : null}

        <DialogFooter className="r22-composer-footer">
          {seed.mode === "edit" && !["PUBLISHED", "CANCELLED"].includes(seed.post.status) ? <Button unstyled type="button" className="is-danger" disabled={busy} onClick={() => setConfirmAction("cancel-post")}>Cancel post</Button> : null}
          <Button unstyled type="button" disabled={busy || !editable} onClick={() => persist(false)}>{busy ? "Saving…" : "Save draft"}</Button>
          <Button unstyled type="button" className="is-primary" disabled={busy || !canApprove} onClick={() => persist(true)}>{busy ? "Saving…" : "Approve & schedule"}</Button>
        </DialogFooter>
      </DialogContent>
      <AlertDialog open={confirmAction !== null} onOpenChange={(open) => { if (!open) setConfirmAction(null); }}>
        <AlertDialogContent className="r22-schedule-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmAction === "cancel-post" ? "Cancel this post?" : "Discard these changes?"}</AlertDialogTitle>
            <AlertDialogDescription>{confirmAction === "cancel-post" ? "It will be removed from the active Schedule. This does not refund media generation credits." : "Your unsaved Schedule changes will be lost."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (confirmAction === "cancel-post") void cancelPost();
              else {
                if (fixture) clearFixtureDraft(seed);
                onClose();
              }
              setConfirmAction(null);
            }}>{confirmAction === "cancel-post" ? "Cancel post" : "Discard changes"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

export type { ComposerSeed as R22ScheduleComposerSeed };
