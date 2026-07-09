"use client";

/**
 * 沉浸式 · Cast —— 训练型人设(Soul-ID 式:一次训练永久锁脸)。原生重建,全真人像。
 * 上传参考照 → 假想训练进度 → 锁脸完成落地 sweep(castTrained 落进共享事件流)。
 * ready 人设接真去处:Use in a video → canvas(不留死胡同)。§O5 就地进度,零头像。
 * [wave-b] B-05 训练型人设本体(≥20 张照片跨风格/姿势/光线锁同一张脸,训后不限量出图)。
 */

import * as React from "react";
import Link from "next/link";
import { Plus, Sparkles, Upload, Users } from "lucide-react";
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
import { SweepIn } from "@/components/northstar/assets/_zone";
import { SCENE_PACKS, type Persona } from "@/components/northstar/assets/_data";
import { nsImage } from "@/components/northstar/_mock";
import { castTrained, useStore, castPersonas, castAddPersona, castStartTraining, castAdvanceTraining } from "../_store";
import { OttoAssist } from "../otto-assist";
import { PageHeader, EmptyState, SectionTitle, AssetsNav, ASSETS_BASE } from "./kit";

const NEW_PERSONA: Persona = {
  id: "ps-new",
  name: "Mak Cik Ros",
  role: "Pasar regular",
  status: "training",
  portrait: nsImage("portrait", 24),
  progress: 0,
};

export function AssetsCast() {
  useStore();
  // 单源:人设列表 + 训练态读共享 store(新建/进度/锁脸跨页存活),不再私藏副本。
  const personas = castPersonas();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [landed, setLanded] = React.useState<Record<string, true>>({});

  React.useEffect(() => {
    const hasTraining = personas.some((p) => p.status === "training");
    if (!hasTraining) return;
    const timer = window.setInterval(() => {
      castAdvanceTraining();
    }, 600);
    return () => window.clearInterval(timer);
  }, [personas]);

  const prevStatuses = React.useRef<Record<string, Persona["status"]>>({});
  React.useEffect(() => {
    const newlyReady = personas.filter(
      (p) => p.status === "ready" && prevStatuses.current[p.id] === "training",
    );
    if (newlyReady.length > 0) {
      setLanded((l) => ({ ...l, ...Object.fromEntries(newlyReady.map((p) => [p.id, true as const])) }));
      newlyReady.forEach((p) => castTrained(p.name));
    }
    prevStatuses.current = Object.fromEntries(personas.map((p) => [p.id, p.status]));
  }, [personas]);

  const startTraining = (id: string) => {
    castStartTraining(id);
  };

  const addPersona = () => {
    setDialogOpen(false);
    castAddPersona({ ...NEW_PERSONA });
  };

  const readyCount = personas.filter((p) => p.status === "ready").length;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1280px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Cast"
        subtitle="Trained faces for your videos. Train once from about 20 photos and the face stays locked across every style, pose and light."
        actions={
          <div className="flex items-center gap-2">
            <AssetsNav />
            {/* §O7 一颗 Otto 帮我:选角没头绪时给方向(纯建议,零打字路径) */}
            <OttoAssist
              zone="Assets"
              entityLabel="your cast"
              intents={[
                {
                  id: "cast-who",
                  label: "Which persona suits my shop?",
                  prompt: "Who should I put in my videos?",
                  reply:
                    "For a Bangsar bakery, a warm home-baker aunty carries the most trust — she reads as the person behind the counter. A young office worker works for weekday “grab-and-go” reels. Train the aunty first; she'll show up in the most posts.",
                },
                {
                  id: "cast-scenes",
                  label: "What scenes fit a KL bakery?",
                  prompt: "Which scene packs should I use?",
                  reply:
                    "Kopitiam mornings for your everyday bakes, Pasar malam for festive pushes, Office pantry KL for the weekday office-order crowd. Pick a persona, then pair them with one pack per campaign so the look stays consistent.",
                },
              ]}
            />
            <Button size="sm" className="ns-pressable" onClick={() => setDialogOpen(true)}>
              <Plus strokeWidth={2} />
              New persona
            </Button>
          </div>
        }
      />

      <div className="mt-6 flex flex-1 flex-col gap-10">
        <section aria-labelledby="cast-personas">
          <div className="flex items-center gap-2">
            <SectionTitle>Your cast</SectionTitle>
            <span className="text-xs text-muted-foreground">{readyCount} ready</span>
          </div>
          {personas.length === 0 ? (
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
          ) : (
            <div className="mt-4 grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
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
          )}
        </section>

        <section aria-labelledby="cast-scenes">
          <SectionTitle>Scene packs</SectionTitle>
          <p className="mt-1 text-sm text-muted-foreground">Local Southeast Asian settings your cast can appear in.</p>
          <div className="mt-4 grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
            {SCENE_PACKS.map((sp) => (
              <div key={sp.id} className="flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-card">
                {/* eslint-disable-next-line @next/next/no-img-element -- 原型层用 <img> 热链 NS_IMAGES */}
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
      </div>

      {/* 新人设对话框(≥20 张参考照 → 训练锁脸) */}
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
                Upload about 20 photos of one face — different angles, poses and light. Train once and the face stays
                locked after that.
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
                <p className="text-xs font-medium text-muted-foreground">Who they play in your videos.</p>
              </div>
              <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-border bg-secondary/50 text-center">
                <Upload className="size-5 text-muted-foreground" strokeWidth={2} />
                <p className="text-sm text-muted-foreground">Drop 20 or more reference photos</p>
                <p className="text-xs text-muted-foreground">22 photos selected · faces detected</p>
              </div>
            </div>
            <DialogFooter className="mt-6">
              <Button type="button" variant="secondary" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" className="ns-pressable">Start training</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PersonaCard({ persona, onTrain }: { persona: Persona; onTrain: () => void }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-card">
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element -- 原型层用 <img> 热链 NS_IMAGES */}
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
          <>
            <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
              Face locked · trained {shortDate(persona.trainedAt ?? "")}
              {typeof persona.scenes === "number" && persona.scenes > 0 ? ` · ${persona.scenes} scenes` : ""}
            </p>
            <Button variant="secondary" size="sm" className="ns-pressable mt-2 self-start" asChild>
              <Link href={`${ASSETS_BASE}/create/canvas?persona=${persona.id}`}>
                <Sparkles strokeWidth={2} />
                Use in a video
              </Link>
            </Button>
          </>
        )}

        {persona.status === "training" && (
          <>
            <div className="mt-1 flex items-center gap-2">
              <Progress value={persona.progress ?? 0} aria-label={`Training ${persona.name}`} className="h-2 flex-1" />
              <span className="shrink-0 font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground tabular-nums">
                {persona.progress ?? 0}%
              </span>
            </div>
            <p className="text-[11px] leading-[14px] text-muted-foreground">Locking the face…</p>
          </>
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
