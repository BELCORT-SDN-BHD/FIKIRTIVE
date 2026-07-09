/* @nsPage district="资产区" page="cast" status="draft"
   sources="harmony-01 #3;harmony-03 Wave 3;判决 7-6" approvedAt="" pr="" */
"use client";

/**
 * 选角库(Cast / 人设)— 训练型人设:「训练一次永久锁脸」(P2 · 未建,Wave 3 原节奏)
 * 清单要素:PersonaIdentity 列表、训练状态(ready / training / draft;training 用
 * §FB8 决定式进度 = 8px 轨 + micro-mono 计数,训练完成落地 sweep)、
 * SEA 本地面孔与场景包(Wave 3,不提前发明参数)。
 * Otto 出场:训练是后台工作,就地 in-element 进度(§O5 nearest-first),零头像。
 */

import * as React from "react";
import { Plus, Upload, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DemoStateBar,
  ErrorPanel,
  SkeletonGrid,
  SweepIn,
  type DemoState,
} from "@/components/northstar/assets/_zone";
import { PERSONAS, SCENE_PACKS, type Persona } from "@/components/northstar/assets/_data";
import { EmptyState, MockNote, PageHeader } from "@/components/northstar/_shared";
import { nsPlaceholder } from "@/components/northstar/_mock";
import { castTrained } from "@/components/northstar/immersive/_store";

const NEW_PERSONA: Persona = {
  id: "ps-new",
  name: "Mak Cik Ros",
  role: "Pasar regular",
  status: "training",
  portrait: nsPlaceholder("Mak Cik Ros", 480, 480, "pandan"),
  progress: 0,
};

export default function Page() {
  const [demo, setDemo] = React.useState<DemoState>("normal");
  const [personas, setPersonas] = React.useState<Persona[]>(PERSONAS);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [landed, setLanded] = React.useState<Record<string, true>>({});

  /* 训练进度模拟:一个 interval 推进所有 training 人设;完成 → ready */
  React.useEffect(() => {
    const hasTraining = personas.some((p) => p.status === "training");
    if (!hasTraining) return;
    const timer = window.setInterval(() => {
      setPersonas((prev) =>
        prev.map((p) => {
          if (p.status !== "training") return p;
          const next = Math.min(100, (p.progress ?? 0) + 4);
          if (next >= 100) {
            return { ...p, status: "ready", progress: undefined, trainedAt: "2026-07-07", scenes: 0 };
          }
          return { ...p, progress: next };
        }),
      );
    }, 600);
    return () => window.clearInterval(timer);
  }, [personas]);

  /* training → ready 的瞬间 = 落地 sweep(状态迁移派生,不在 updater 里做副作用) */
  const prevStatuses = React.useRef<Record<string, Persona["status"]>>({});
  React.useEffect(() => {
    const newlyReady = personas.filter(
      (p) => p.status === "ready" && prevStatuses.current[p.id] === "training",
    );
    if (newlyReady.length > 0) {
      setLanded((l) => ({
        ...l,
        ...Object.fromEntries(newlyReady.map((p) => [p.id, true as const])),
      }));
      // 训练完成落进共享事件流(分析区实时活动读它)。
      newlyReady.forEach((p) => castTrained(p.name));
    }
    prevStatuses.current = Object.fromEntries(personas.map((p) => [p.id, p.status]));
  }, [personas]);

  const startTraining = (id: string) => {
    setPersonas((prev) =>
      prev.map((p) => (p.id === id ? { ...p, status: "training", progress: 0 } : p)),
    );
  };

  const addPersona = () => {
    setDialogOpen(false);
    setPersonas((prev) =>
      prev.some((p) => p.id === NEW_PERSONA.id) ? prev : [{ ...NEW_PERSONA }, ...prev],
    );
  };

  const readyCount = personas.filter((p) => p.status === "ready").length;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1280px] flex-col px-6 pt-6 pb-10">
      <PageHeader
        title="Cast"
        subtitle="Trained faces for your videos. Train once and the face stays locked."
        meta={[`${readyCount} ready`]}
        actions={
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus strokeWidth={2} />
            New persona
          </Button>
        }
      />

      {/* 三态齐全(harmony-06 §一):header 永远在场,状态活在 body */}
      <div className="mt-6 flex flex-1 flex-col gap-10">
        {demo === "loading" && <SkeletonGrid count={8} minPx={240} />}

        {demo === "empty" && (
          <EmptyState
            icon={Users}
            title="No personas yet"
            body="Train your first face. Once trained, it stays consistent in every video."
            action={
              <Button size="sm" onClick={() => setDialogOpen(true)}>
                New persona
              </Button>
            }
          />
        )}

        {demo === "error" && (
          <ErrorPanel message="Couldn't load your cast. Try again." onRetry={() => setDemo("normal")} />
        )}

        {demo === "normal" && (
          <>
            {/* ── 人设列表 ── */}
            <section aria-labelledby="cast-personas">
              <h2 id="cast-personas" className="sr-only">
                Personas
              </h2>
              <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
                {personas.map((p) => {
                  const card = <PersonaCard persona={p} onTrain={() => startTraining(p.id)} />;
                  return landed[p.id] ? (
                    <SweepIn key={`${p.id}-landed`} className="rounded-[var(--radius-card)]">
                      {card}
                    </SweepIn>
                  ) : (
                    <div key={p.id}>{card}</div>
                  );
                })}
              </div>
            </section>

            {/* ── SEA 场景包(Wave 3) ── */}
            <section aria-labelledby="cast-scenes">
              <h2
                id="cast-scenes"
                className="text-xl leading-[26px] font-semibold tracking-[-0.017em] text-foreground"
              >
                Scene packs
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Local Southeast Asian settings your cast can appear in.
              </p>
              <div className="mt-4 grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
                {SCENE_PACKS.map((sp) => (
                  <div key={sp.id} className="flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-card">
                    {/* eslint-disable-next-line @next/next/no-img-element -- 原型内联 SVG data URI 占位图 */}
                    <img src={sp.cover} alt={sp.name} className="aspect-[8/5] w-full object-cover" />
                    <div className="flex flex-col gap-0.5 p-4">
                      <div className="flex items-center gap-2">
                        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{sp.name}</p>
                        <span className="shrink-0 font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground tabular-nums">
                          {sp.scenes} scenes
                        </span>
                      </div>
                      <p className="text-[13px] leading-[18px] text-muted-foreground">{sp.note}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>

      {/* 新人设对话框(M 号;照片区为原型示意) */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-[min(560px,calc(100vw-2rem))]">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addPersona();
            }}
          >
            <DialogHeader>
              <DialogTitle>New persona</DialogTitle>
              <DialogDescription>
                Train once from a few reference photos. The face stays locked after that.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label htmlFor="cast-name" className="text-[13px] leading-[18px] font-semibold text-foreground">
                  Name
                </label>
                <Input id="cast-name" defaultValue="Mak Cik Ros" placeholder="Aunty Salmah" />
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="cast-role" className="text-[13px] leading-[18px] font-semibold text-foreground">
                  Role
                </label>
                <Input id="cast-role" defaultValue="Pasar regular" placeholder="Home baker aunty" />
                <p className="text-xs font-medium text-muted-foreground">
                  Who they play in your videos.
                </p>
              </div>
              <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-border bg-secondary/50 text-center">
                <Upload className="size-5 text-muted-foreground" strokeWidth={2} />
                <p className="text-sm text-muted-foreground">Drop 4 to 8 reference photos</p>
                <p className="text-xs text-muted-foreground">6 photos selected</p>
              </div>
            </div>
            <DialogFooter className="mt-6">
              <Button type="button" variant="secondary" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Start training</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <MockNote path="/northstar/assets/cast" />
      <DemoStateBar state={demo} onChange={setDemo} />
    </div>
  );
}

function PersonaCard({ persona, onTrain }: { persona: Persona; onTrain: () => void }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-card">
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element -- 原型内联 SVG data URI 占位图 */}
        <img src={persona.portrait} alt={persona.name} className="aspect-square w-full object-cover" />
        <span className="absolute top-2 right-2">
          {persona.status === "ready" && <Badge variant="success">Ready</Badge>}
          {persona.status === "training" && <Badge variant="info">Training</Badge>}
          {persona.status === "draft" && <Badge variant="outline">Draft</Badge>}
        </span>
      </div>
      <div className="flex flex-col gap-1 p-4">
        <p className="truncate text-sm font-semibold text-foreground">{persona.name}</p>
        <p className="text-xs text-muted-foreground">{persona.role}</p>

        {persona.status === "ready" && (
          <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
            Face locked · trained {shortDate(persona.trainedAt ?? "")}
            {typeof persona.scenes === "number" && persona.scenes > 0 ? ` · ${persona.scenes} scenes` : ""}
          </p>
        )}

        {/* §FB8 决定式进度:轨 + micro-mono 计数一对出现 */}
        {persona.status === "training" && (
          <div className="mt-1 flex items-center gap-2">
            <Progress
              value={persona.progress ?? 0}
              aria-label={`Training ${persona.name}`}
              className="h-2 flex-1"
            />
            <span className="shrink-0 font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground tabular-nums">
              {persona.progress ?? 0}%
            </span>
          </div>
        )}
        {persona.status === "training" && (
          <p className="text-[11px] leading-[14px] text-muted-foreground">Locking the face…</p>
        )}

        {persona.status === "draft" && (
          <Button variant="secondary" size="sm" className="mt-2 self-start" onClick={onTrain}>
            Continue training
          </Button>
        )}
      </div>
    </div>
  );
}

function shortDate(iso: string): string {
  if (iso.length < 10) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(iso.slice(8, 10))} ${months[Number(iso.slice(5, 7)) - 1]}`;
}
