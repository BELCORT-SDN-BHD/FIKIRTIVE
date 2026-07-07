"use client";

/**
 * Account 设置页(Account)
 * 资料 + Otto 行为设置。
 * 布局:§L2 Settings 型:sticky jump-nav 216 + 单列 760(≤680 nav → chip 行)。
 * §O3:此页无 inline Otto avatar — 身份决定读作用户的(dock only)。
 * §F1 字段解剖:label → control → help;§F7 开关即时生效(checked = INK)。
 * 语气:资料 dirty → Save 可用;保存后回 clean(值本身就是反馈,零 toast)。
 */

import * as React from "react";
import { Bot, Check, LogOut, ShieldAlert, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MockNote, PageHeader } from "@/components/northstar/_shared";
import { SweepIn } from "./_bits";
import { OTTO_BEHAVIOURS, PROFILE } from "./_data";

const JUMP = [
  { id: "profile", label: "Profile" },
  { id: "otto", label: "Otto behaviour" },
  { id: "account", label: "Account" },
] as const;

interface Field {
  key: keyof typeof PROFILE;
  label: string;
  help?: string;
  type?: string;
}

const PROFILE_FIELDS: Field[] = [
  { key: "brandName", label: "Business name" },
  { key: "ownerName", label: "Your name" },
  { key: "email", label: "Email", help: "We send work updates and receipts here.", type: "email" },
  { key: "phone", label: "Phone", type: "tel" },
  { key: "city", label: "City" },
];

export function SettingsPage() {
  // 资料本地态:dirty 判定驱动 Save
  const [profile, setProfile] = React.useState({
    brandName: PROFILE.brandName,
    ownerName: PROFILE.ownerName,
    email: PROFILE.email,
    phone: PROFILE.phone,
    city: PROFILE.city,
  });
  const [saved, setSaved] = React.useState(profile);
  const [saving, setSaving] = React.useState(false);
  const [justSaved, setJustSaved] = React.useState(false);
  const saveTimer = React.useRef<number | null>(null);
  const flashTimer = React.useRef<number | null>(null);

  // Otto 行为开关(即时生效)
  const [behaviours, setBehaviours] = React.useState(() =>
    Object.fromEntries(OTTO_BEHAVIOURS.map((b) => [b.id, b.value])),
  );

  const [signOutOpen, setSignOutOpen] = React.useState(false);
  const [active, setActive] = React.useState<string>("profile");

  React.useEffect(
    () => () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
    },
    [],
  );

  const dirty = (Object.keys(profile) as (keyof typeof profile)[]).some(
    (k) => profile[k] !== saved[k],
  );

  const saveProfile = () => {
    setSaving(true);
    saveTimer.current = window.setTimeout(() => {
      setSaved(profile);
      setSaving(false);
      setJustSaved(true);
      flashTimer.current = window.setTimeout(() => setJustSaved(false), 2400);
    }, 600);
  };

  // sticky nav 高亮(简易:滚到哪个 section)
  React.useEffect(() => {
    const ids = JUMP.map((j) => j.id);
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -60% 0px" },
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, []);

  return (
    <div className="mx-auto w-full max-w-[1024px] px-6 pt-6 pb-10">
      <PageHeader title="Account" subtitle="Your details and how Otto works for you." />

      <div className="mt-6 flex flex-col gap-8 md:flex-row md:gap-10">
        {/* sticky jump-nav 216(≤md → chip 行) */}
        <nav
          aria-label="Settings sections"
          className="flex shrink-0 gap-1 overflow-x-auto md:sticky md:top-6 md:h-max md:w-[216px] md:flex-col md:overflow-visible"
        >
          {JUMP.map((j) => (
            <a
              key={j.id}
              href={`#${j.id}`}
              aria-current={active === j.id ? "true" : undefined}
              className={cn(
                "shrink-0 rounded-[10px] px-3 py-2 text-[13px] font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
                active === j.id
                  ? "bg-secondary font-semibold text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {j.label}
            </a>
          ))}
        </nav>

        {/* 内容列 760 */}
        <div className="min-w-0 flex-1 md:max-w-[760px]">
          {/* ── Profile ── */}
          <section id="profile" style={{ scrollMarginTop: 24 }}>
            <h2 className="text-xl leading-[26px] font-semibold tracking-[-0.017em] text-foreground">
              Profile
            </h2>

            <div className="mt-4 flex items-center gap-4">
              <span
                aria-hidden
                className="flex size-14 items-center justify-center rounded-[16px] bg-secondary text-lg font-bold text-foreground"
              >
                {PROFILE.brandName[0]}
              </span>
              <div className="flex flex-col">
                <p className="text-sm font-semibold text-foreground">{profile.brandName}</p>
                <p className="text-xs text-muted-foreground">{PROFILE.timezone}</p>
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-5">
              {PROFILE_FIELDS.map((f) => (
                <div key={f.key} className="flex flex-col gap-2">
                  <label
                    htmlFor={`pf-${f.key}`}
                    className="text-[13px] leading-[18px] font-semibold text-foreground"
                  >
                    {f.label}
                  </label>
                  <Input
                    id={`pf-${f.key}`}
                    type={f.type ?? "text"}
                    value={profile[f.key as keyof typeof profile]}
                    onChange={(e) =>
                      setProfile((p) => ({ ...p, [f.key]: e.target.value }))
                    }
                  />
                  {f.help && <p className="text-xs font-medium text-muted-foreground">{f.help}</p>}
                </div>
              ))}
            </div>

            <div className="mt-5 flex items-center gap-3">
              <Button size="sm" disabled={!dirty || saving} onClick={saveProfile}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
              {justSaved && (
                <SweepIn>
                  <span className="flex items-center gap-1.5 text-[13px] font-medium text-success-soft-foreground">
                    <Check className="size-3.5" strokeWidth={2} />
                    Saved
                  </span>
                </SweepIn>
              )}
            </div>
          </section>

          <hr className="my-8 border-border" />

          {/* ── Otto behaviour ── */}
          <section id="otto" style={{ scrollMarginTop: 24 }}>
            <h2 className="text-xl leading-[26px] font-semibold tracking-[-0.017em] text-foreground">
              Otto behaviour
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Decide how much Otto does on its own. You always see the work first.
            </p>

            <div className="mt-4 overflow-hidden rounded-[14px] border border-border bg-card">
              {OTTO_BEHAVIOURS.map((b, i) => (
                <div
                  key={b.id}
                  className={cn(
                    "flex items-start justify-between gap-4 px-4 py-4",
                    i > 0 && "border-t border-border",
                  )}
                >
                  <label htmlFor={`ob-${b.id}`} className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[14px] leading-[20px] font-semibold text-foreground">
                      {b.title}
                    </span>
                    <span className="mt-0.5 text-xs leading-[16px] text-muted-foreground">
                      {b.help}
                    </span>
                  </label>
                  <Switch
                    id={`ob-${b.id}`}
                    checked={behaviours[b.id]}
                    onCheckedChange={(v) => setBehaviours((prev) => ({ ...prev, [b.id]: v }))}
                    aria-label={b.title}
                  />
                </div>
              ))}
            </div>

            <div className="mt-4 flex items-start gap-3 rounded-[14px] bg-info-soft px-4 py-3">
              <Bot className="mt-0.5 size-4 shrink-0 text-info-soft-foreground" strokeWidth={2} />
              <p className="text-[13px] leading-[18px] font-medium text-info-soft-foreground">
                Otto never spends credits or posts to a channel without your approval, whatever these
                are set to.
              </p>
            </div>
          </section>

          <hr className="my-8 border-border" />

          {/* ── Account ── */}
          <section id="account" style={{ scrollMarginTop: 24 }}>
            <h2 className="text-xl leading-[26px] font-semibold tracking-[-0.017em] text-foreground">
              Account
            </h2>

            <div className="mt-4 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-4 rounded-[14px] border border-border bg-card px-4 py-3.5">
                <div className="flex min-w-0 items-center gap-3">
                  <User className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{profile.ownerName}</p>
                    <p className="truncate text-xs text-muted-foreground">{profile.email}</p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setSignOutOpen(true)}>
                  <LogOut className="size-4" strokeWidth={2} />
                  Sign out
                </Button>
              </div>

              {/* 危险区(§L2 settings danger:text --error) */}
              <div className="flex items-center justify-between gap-4 rounded-[14px] border border-border bg-card px-4 py-3.5">
                <div className="flex min-w-0 items-center gap-3">
                  <ShieldAlert className="size-4 shrink-0 text-error-soft-foreground" strokeWidth={2} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">Close account</p>
                    <p className="truncate text-xs text-muted-foreground">
                      Talk to us first. Your work and credits are yours.
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-error-soft-foreground hover:bg-error-soft hover:text-error-soft-foreground"
                >
                  Contact us
                </Button>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* 退出确认(§FB5 S) */}
      <Dialog open={signOutOpen} onOpenChange={setSignOutOpen}>
        <DialogContent className="max-w-[min(440px,calc(100vw-2rem))]">
          <DialogHeader>
            <DialogTitle>Sign out?</DialogTitle>
            <DialogDescription>
              Otto keeps working on anything already running. Your drafts are saved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setSignOutOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => setSignOutOpen(false)}>Sign out</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MockNote path="/northstar/account/settings" />
    </div>
  );
}
