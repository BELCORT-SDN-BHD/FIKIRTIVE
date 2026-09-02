"use client";

import * as React from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  Maximize2,
  Minimize2,
  Plus,
  Search,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";

import { OttoMark } from "@/components/brand/OttoMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { TooltipButton } from "@/components/ui/tooltip-button";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { OttoPanelShell, useOttoPanelControls } from "./OttoPanelShell";

type AnswerKind = "budget" | "attribution" | "creative" | "follow-up";

type Turn = {
  id: string;
  prompt: string;
  answer: AnswerKind | null;
};

type Conversation = {
  id: string;
  title: string;
  turns: Turn[];
};

const STARTERS = [
  "Explain what changed this month",
  "Compare the last 30 days",
  "Plan the next best action",
  "Review my attribution gaps",
] as const;

const THINKING_DELAY_MS = 1400;

const RECENT_CONVERSATION_FIXTURES: Conversation[] = [
  {
    id: "attribution-gap",
    title: "Review attribution gaps",
    turns: [{ id: "attribution-1", prompt: "Where are the biggest gaps in my attribution?", answer: "attribution" }],
  },
  {
    id: "creative-winner",
    title: "Why did this creative win?",
    turns: [{ id: "creative-1", prompt: "Why is the coffee ritual video outperforming the others?", answer: "creative" }],
  },
];

function initialConversations(recommendedPrompt: string): Conversation[] {
  return [
    {
      id: "campaign-budget",
      title: "Increase campaign budget?",
      turns: [{ id: "budget-1", prompt: recommendedPrompt, answer: "budget" }],
    },
    ...RECENT_CONVERSATION_FIXTURES,
  ];
}

const OttoReferenceContext = React.createContext<{ askOtto: (prompt: string) => void } | null>(null);

export function useOttoPanelReference() {
  return React.useContext(OttoReferenceContext);
}

function titleForPrompt(prompt: string): string {
  const compact = prompt.replace(/[?.!]$/, "").trim();
  return compact.length > 34 ? `${compact.slice(0, 34)}…` : compact;
}

function answerForPrompt(prompt: string): AnswerKind {
  const normalized = prompt.toLowerCase();
  if (normalized.includes("attribution")) return "attribution";
  if (normalized.includes("creative") || normalized.includes("video")) return "creative";
  if (normalized.includes("budget") || normalized.includes("next best action")) return "budget";
  return "follow-up";
}

function ReferenceBridge({
  children,
  onSeed,
}: {
  children: React.ReactNode;
  onSeed: (prompt: string) => void;
}) {
  const controls = useOttoPanelControls();
  const value = React.useMemo(
    () => ({
      askOtto(prompt: string) {
        onSeed(prompt);
        controls?.openPanel();
      },
    }),
    [controls, onSeed],
  );

  return <OttoReferenceContext.Provider value={value}>{children}</OttoReferenceContext.Provider>;
}

function ReferenceHeader({
  title,
  conversations,
  onNew,
  onSelect,
}: {
  title: string;
  conversations: Conversation[];
  onNew: () => void;
  onSelect: (conversation: Conversation) => void;
}) {
  const controls = useOttoPanelControls();
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const filtered = conversations.filter((conversation) =>
    conversation.title.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <>
      <Popover
        open={historyOpen}
        onOpenChange={(nextOpen) => {
          setHistoryOpen(nextOpen);
          if (!nextOpen) setQuery("");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-otto-reference-history-trigger=""
            className="mr-auto min-w-0 justify-start px-2 font-semibold"
          >
            <span className="truncate">{title}</span>
            <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={8} className="w-[310px] p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search conversations"
              placeholder="Search conversations"
              className="h-9 pl-9 text-sm"
            />
          </div>
          <p className="px-2 pt-3 pb-1 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">Today</p>
          <div className="space-y-0.5">
            {filtered.map((conversation) => (
              <Button
                key={conversation.id}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  onSelect(conversation);
                  setHistoryOpen(false);
                  setQuery("");
                }}
                className="w-full justify-start overflow-hidden px-2 font-normal"
              >
                <span className="truncate">{conversation.title}</span>
              </Button>
            ))}
            {filtered.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">No conversations found.</p>
            ) : null}
          </div>
          <div className="mt-1 border-t border-border pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onNew();
                setHistoryOpen(false);
                setQuery("");
              }}
              className="w-full justify-start px-2 font-normal"
            >
              <Plus aria-hidden /> New conversation
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <TooltipButton label="New conversation" side="bottom" variant="ghost" size="icon-xs" onClick={onNew}>
        <Plus aria-hidden />
      </TooltipButton>
      <TooltipButton
        label={controls?.fullscreen ? "Exit fullscreen" : "Open fullscreen"}
        side="bottom"
        variant="ghost"
        size="icon-xs"
        aria-pressed={controls?.fullscreen}
        onClick={() => controls?.toggleFullscreen()}
      >
        {controls?.fullscreen ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
      </TooltipButton>
      <TooltipButton label="Close Otto" side="bottom" variant="ghost" size="icon-xs" onClick={() => controls?.closePanel()}>
        <X aria-hidden />
      </TooltipButton>
    </>
  );
}

function EmptyConversation({ founderName, onPrompt }: { founderName: string; onPrompt: (prompt: string) => void }) {
  return (
    <div data-otto-reference-empty="" className="flex min-h-full flex-col items-center justify-center px-5 py-10 text-center">
      <OttoMark expression="helpful" size={82} />
      <h2 className="mt-5 text-lg font-semibold tracking-[-0.02em]">Good evening, {founderName}.</h2>
      <p className="mt-1 text-sm text-muted-foreground">What should we improve today?</p>
      <div className="mt-7 grid w-full max-w-md gap-2">
        {STARTERS.map((starter) => (
          <Button
            key={starter}
            type="button"
            variant="secondary"
            onClick={() => onPrompt(starter)}
            className="h-auto min-h-11 justify-start whitespace-normal px-3.5 py-2.5 text-left text-[13px] font-medium"
          >
            {starter}
          </Button>
        ))}
      </div>
    </div>
  );
}

function Answer({ kind }: { kind: AnswerKind }) {
  if (kind === "attribution") {
    return (
      <>
        <h3 className="font-semibold">Two gaps are hiding part of your marketing impact</h3>
        <ol className="mt-3 list-decimal space-y-2 pl-5">
          <li>Email revenue is reported, but campaign tags are missing on 18% of sessions.</li>
          <li>Organic conversions are grouped as direct when the first visit happened more than 30 days ago.</li>
        </ol>
        <p className="mt-3">Fix campaign tagging first. It is the larger and more actionable gap.</p>
      </>
    );
  }
  if (kind === "creative") {
    return (
      <>
        <h3 className="font-semibold">The coffee ritual video wins on attention and intent</h3>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>Its first three seconds retain 31% more viewers.</li>
          <li>Product use is visible before the offer appears.</li>
          <li>It converts at 2.6%, compared with the 1.9% account average.</li>
        </ul>
        <p className="mt-3">Keep the opening sequence and test a shorter offer ending next.</p>
      </>
    );
  }
  if (kind === "follow-up") {
    return (
      <>
        <h3 className="font-semibold">Start with the change that is easiest to measure</h3>
        <p className="mt-3">Use one controlled campaign adjustment, keep the creative unchanged, and review the result after three complete days.</p>
      </>
    );
  }
  return (
    <>
      <h3 className="font-semibold">Increase the budget gradually</h3>
      <p className="mt-3">Sales Aug 2026 is returning 4.6x and has remained stable for seven days. The clearest next step is a controlled increase:</p>
      <ol className="mt-3 list-decimal space-y-2 pl-5">
        <li>Raise the daily budget by RM 60.</li>
        <li>Keep the current audience and creative unchanged.</li>
        <li>Review ROAS and cost per purchase after three complete days.</li>
      </ol>
      <p className="mt-3">Estimated additional spend is RM 180 before the first review.</p>
    </>
  );
}

function AnswerTurn({
  turn,
  copied,
  feedback,
  onCopy,
  onFeedback,
}: {
  turn: Turn & { answer: AnswerKind };
  copied: boolean;
  feedback: "up" | "down" | undefined;
  onCopy: (turnId: string, answer: string) => void;
  onFeedback: (turnId: string, value: "up" | "down") => void;
}) {
  const answerRef = React.useRef<HTMLDivElement>(null);

  return (
    <div className="mt-5 text-sm leading-6">
      <div ref={answerRef} data-otto-reference-answer={turn.id}>
        <Answer kind={turn.answer} />
      </div>
      <div className="mt-5 flex items-center gap-0.5 text-muted-foreground">
        <TooltipButton
          label={copied ? "Copied" : "Copy answer"}
          variant="ghost"
          size="icon-xs"
          onClick={() => onCopy(turn.id, answerRef.current?.textContent?.trim() ?? "")}
        >
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        </TooltipButton>
        <TooltipButton
          label="Helpful"
          variant="ghost"
          size="icon-xs"
          aria-pressed={feedback === "up"}
          onClick={() => onFeedback(turn.id, "up")}
        >
          <ThumbsUp className={cn(feedback === "up" && "fill-current text-foreground")} aria-hidden />
        </TooltipButton>
        <TooltipButton
          label="Not helpful"
          variant="ghost"
          size="icon-xs"
          aria-pressed={feedback === "down"}
          onClick={() => onFeedback(turn.id, "down")}
        >
          <ThumbsDown className={cn(feedback === "down" && "fill-current text-foreground")} aria-hidden />
        </TooltipButton>
      </div>
      {turn.answer === "budget" ? (
        <div className="mt-5 rounded-[var(--radius-card)] border border-border bg-secondary/45 p-4">
          <p className="text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">Review required</p>
          <p className="mt-2 font-semibold">Increase daily budget by RM 60</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Nothing changes until you review the budget, expected spend, and approval details.</p>
          <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={() => toast.info("Preview only. No campaign was changed.")}>
            Review budget change
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ConversationBody({
  conversation,
  thinking,
  copiedTurnId,
  feedbackByTurn,
  onCopy,
  onFeedback,
}: {
  conversation: Conversation;
  thinking: boolean;
  copiedTurnId: string | null;
  feedbackByTurn: Record<string, "up" | "down" | undefined>;
  onCopy: (turnId: string, answer: string) => void;
  onFeedback: (turnId: string, value: "up" | "down") => void;
}) {
  const controls = useOttoPanelControls();
  return (
    <div
      data-otto-reference-conversation=""
      data-otto-reference-layout={controls?.fullscreen ? "fullscreen" : "panel"}
      className={cn("w-full px-4 py-5", controls?.fullscreen ? "px-6 py-8" : "max-w-full")}
    >
      {conversation.turns.map((turn, index) => (
        <div key={turn.id} className={cn(index > 0 && "mt-8")}>
          {index > 0 ? (
            <div className={cn("mb-8 border-t border-border", controls?.fullscreen && "max-w-[760px]")} />
          ) : null}
          <div
            data-otto-reference-prompt={turn.id}
            className={cn(
              "ml-auto w-fit rounded-[16px] rounded-tr-[5px] bg-secondary px-3.5 py-2.5 text-sm leading-6",
              controls?.fullscreen ? "max-w-[min(42rem,72%)]" : "max-w-[88%]",
            )}
          >
            {turn.prompt}
          </div>
          {turn.answer ? (
            <div data-otto-reference-answer-column="" className={cn(controls?.fullscreen && "max-w-[760px]")}>
              <AnswerTurn
                turn={{ ...turn, answer: turn.answer }}
                copied={copiedTurnId === turn.id}
                feedback={feedbackByTurn[turn.id]}
                onCopy={onCopy}
                onFeedback={onFeedback}
              />
            </div>
          ) : null}
        </div>
      ))}
      {thinking ? (
        <div data-otto-reference-thinking="" className="mt-5 flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
          <OttoMark size={24} />
          <span>Reviewing your marketing health…</span>
          <span className="size-1.5 animate-pulse rounded-full bg-brand" aria-hidden />
        </div>
      ) : null}
    </div>
  );
}

function Composer({
  draft,
  thinking,
  onDraftChange,
  onSubmit,
}: {
  draft: string;
  thinking: boolean;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="relative rounded-[var(--radius-card)] border border-border bg-card shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/25">
      <Textarea
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey) return;
          event.preventDefault();
          onSubmit();
        }}
        aria-label="Message Otto"
        placeholder="What should we improve?"
        disabled={thinking}
        className="min-h-[72px] resize-none border-0 bg-transparent pr-12 pb-8 text-sm shadow-none focus-visible:ring-0"
      />
      <span className="absolute bottom-2.5 left-3.5 text-[11px] text-muted-foreground">Shift+Enter for a new line</span>
      <Button
        type="button"
        variant="otto"
        size="icon-xs"
        aria-label="Send message"
        disabled={thinking || draft.trim().length === 0}
        onClick={onSubmit}
        className="absolute right-2.5 bottom-2.5 rounded-full"
      >
        <ArrowUp aria-hidden />
      </Button>
    </div>
  );
}

export function OttoPanelFlowReference({
  children,
  founderName,
  recommendedPrompt,
}: {
  children: React.ReactNode;
  founderName: string;
  recommendedPrompt: string;
}) {
  const [conversation, setConversation] = React.useState<Conversation>({ id: "new", title: "New conversation", turns: [] });
  const [conversations, setConversations] = React.useState<Conversation[]>(() => initialConversations(recommendedPrompt));
  const [draft, setDraft] = React.useState("");
  const [thinking, setThinking] = React.useState(false);
  const [copiedTurnId, setCopiedTurnId] = React.useState<string | null>(null);
  const [feedbackByTurn, setFeedbackByTurn] = React.useState<Record<string, "up" | "down" | undefined>>({});
  const timerRef = React.useRef<number | null>(null);

  React.useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  const visibleConversations = React.useMemo(
    () => conversation.turns.length === 0
      ? conversations
      : [conversation, ...conversations.filter((item) => item.id !== conversation.id)],
    [conversation, conversations],
  );

  const rememberCurrentConversation = React.useCallback(() => {
    if (conversation.turns.length === 0) return;
    setConversations((current) => [conversation, ...current.filter((item) => item.id !== conversation.id)]);
  }, [conversation]);

  const cancelThinking = React.useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setThinking(false);
  }, []);

  const startNew = React.useCallback(() => {
    cancelThinking();
    rememberCurrentConversation();
    setConversation({ id: `new-${Date.now()}`, title: "New conversation", turns: [] });
    setDraft("");
    setCopiedTurnId(null);
    setFeedbackByTurn({});
  }, [cancelThinking, rememberCurrentConversation]);

  const selectConversation = React.useCallback((next: Conversation) => {
    cancelThinking();
    rememberCurrentConversation();
    setConversation(next);
    setDraft("");
    setCopiedTurnId(null);
    setFeedbackByTurn({});
  }, [cancelThinking, rememberCurrentConversation]);

  const seedPrompt = React.useCallback((prompt: string) => {
    cancelThinking();
    rememberCurrentConversation();
    setConversation({ id: `new-${Date.now()}`, title: "New conversation", turns: [] });
    setDraft(prompt);
    setCopiedTurnId(null);
    setFeedbackByTurn({});
  }, [cancelThinking, rememberCurrentConversation]);

  const submit = React.useCallback((prompt = draft) => {
    const value = prompt.trim();
    if (!value || thinking) return;
    const turnId = `turn-${Date.now()}`;
    setConversation((current) => ({
      ...current,
      title: current.turns.length === 0 ? titleForPrompt(value) : current.title,
      turns: [...current.turns, { id: turnId, prompt: value, answer: null }],
    }));
    setDraft("");
    setThinking(true);
    setCopiedTurnId(null);
    timerRef.current = window.setTimeout(() => {
      setConversation((current) => ({
        ...current,
        turns: current.turns.map((turn) => turn.id === turnId ? { ...turn, answer: answerForPrompt(value) } : turn),
      }));
      setThinking(false);
      timerRef.current = null;
    }, THINKING_DELAY_MS);
  }, [draft, thinking]);

  const copyAnswer = React.useCallback(async (turnId: string, answer: string) => {
    if (!answer || !navigator.clipboard) {
      toast.error("Copy is not available in this browser.");
      return;
    }
    try {
      await navigator.clipboard.writeText(answer);
      setCopiedTurnId(turnId);
    } catch {
      toast.error("Could not copy Otto's answer.");
    }
  }, []);

  return (
    <OttoPanelShell
      panelHeader={
        <ReferenceHeader
          title={conversation.title}
          conversations={visibleConversations}
          onNew={startNew}
          onSelect={selectConversation}
        />
      }
      panelBody={conversation.turns.length === 0 && !thinking ? (
        <EmptyConversation founderName={founderName} onPrompt={(prompt) => submit(prompt)} />
      ) : (
        <ConversationBody
          conversation={conversation}
          thinking={thinking}
          copiedTurnId={copiedTurnId}
          feedbackByTurn={feedbackByTurn}
          onCopy={copyAnswer}
          onFeedback={(turnId, value) => setFeedbackByTurn((current) => ({
            ...current,
            [turnId]: current[turnId] === value ? undefined : value,
          }))}
        />
      )}
      panelFooter={
        <Composer draft={draft} thinking={thinking} onDraftChange={setDraft} onSubmit={() => submit()} />
      }
    >
      <ReferenceBridge onSeed={seedPrompt}>{children}</ReferenceBridge>
    </OttoPanelShell>
  );
}
