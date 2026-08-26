"use client";

/**
 * ProjectStartDialog.tsx —— 按下 Create project 之后弹出来的那一层。
 *
 * 它取代的是一张七格表单(标题 / 目标 / 品牌语气 / 受众 / 语言 / 默认比例 / 上下文)。
 * Founder 2026-08-26 亲验之后原话:「就只是 create 而已」。表单问的每一样都成立,只是
 * 没有一样是**此刻**该问的:商家按下这颗按钮时想的是「开工」,不是「先把我的品牌说清楚」。
 *
 * 换过来的形状照 Stitch 的开局 —— 一句问候 + 一个输入框 + 一排起手模板:
 *   ① **说一句人话就建好**。够清楚就直接建,一句都不多问;
 *   ② **太含糊才问一样**,而且可以跳过(判词在 `project-start.ts`,含糊词族与 Library
 *      快产车间共用同一份);
 *   ③ **建完直接进画布**,刚才这段对话就是那块板上会话的头几条 —— 商家不用把自己
 *      刚说过的话再说一遍。
 *
 * 三条不写在别处的纪律:
 *   · **这一层里一个价钱都不出现**。建项目只是开一张工作台,一分钱都不动;把 cr 摆在
 *     这里等于在说「开个项目要钱」。真正花钱的那一下在画布上,价钱也在那儿。
 *   · **Esc / Cancel 零残留**。旧表单往 sessionStorage 里存草稿,于是关掉再打开,七个格子
 *     原样回来 —— 那对一张表单是体贴,对一句话是纠缠。这一层什么都不存:关掉就是没说过。
 *   · **项目名从那句话派生**,不问。名字改得起;问一句「项目叫什么」换来的多半是 Untitled。
 */

import { ArrowUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { AskOptionCard } from "@/components/otto/conversation/ConversationParts";
import { CreationTemplateRow } from "@/components/creation/CreationTemplateRow";
import {
  NEW_PROJECT_FIXTURE_ID,
  startCanvasFixtureConversation,
  writeNewFixtureProjectName,
} from "@/components/canvas/r22-canvas-fixture";
import { createProject } from "@/lib/actions";

import {
  PROJECT_START_GREETING,
  PROJECT_START_PLACEHOLDER,
  projectNameFromSentence,
  projectStartQuestion,
  type ProjectStartQuestion,
} from "./project-start";
import "./r22-projects.css";

/** 样张里「建项目」这一下的结局。真实那一支的结局由 `createProject` 自己说。 */
export type ProjectCreateOutcome = "success" | "error" | "permission" | "unknown";

export function ProjectStartDialog({
  open,
  onOpenChange,
  fixture = false,
  fixtureCreateOutcome = "success",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fixture?: boolean;
  fixtureCreateOutcome?: ProjectCreateOutcome;
}) {
  const router = useRouter();
  const [sentence, setSentence] = useState("");
  const [asked, setAsked] = useState<ProjectStartQuestion | null>(null);
  const [picked, setPicked] = useState("");
  const [error, setError] = useState("");
  const [fixtureBusy, setFixtureBusy] = useState(false);
  const [fixtureFailedOnce, setFixtureFailedOnce] = useState(false);
  const [pending, startTransition] = useTransition();
  const composerRef = useRef<HTMLTextAreaElement>(null);
  /** 官方示例的 `htmlFor` / `id` 配对要一个稳定前缀 —— 同一页可能开两次这一层。 */
  const askId = useId();

  const busy = pending || fixtureBusy;
  /** 问题卡在的那一段,起手模板与输入一起冻住 —— 与 Library 快产车间同一条纪律。 */
  const locked = asked !== null;

  /** 关掉就是没说过:这一层不往任何地方存草稿,所以「零残留」只是把状态清干净。 */
  useEffect(() => {
    if (open) return;
    setSentence("");
    setAsked(null);
    setPicked("");
    setError("");
    setFixtureBusy(false);
  }, [open]);

  useEffect(() => {
    if (open) composerRef.current?.focus();
  }, [open]);

  /** 建好之后落进那块板的会话:商家说过的话原样在,Otto 没说过的话一句都不编。 */
  function openingConversation(said: string, answer: string): Array<{ from: "me" | "otto"; text: string }> {
    const lines: Array<{ from: "me" | "otto"; text: string }> = [
      { from: "otto", text: PROJECT_START_GREETING },
      { from: "me", text: said },
    ];
    if (asked && answer) {
      lines.push({ from: "otto", text: asked.question });
      lines.push({ from: "me", text: answer });
    }
    return lines;
  }

  function create(answer: string) {
    const said = sentence.trim();
    if (!said || busy) return;
    setError("");
    const name = projectNameFromSentence(said);

    if (fixture) {
      setFixtureBusy(true);
      window.setTimeout(() => {
        setFixtureBusy(false);
        if (fixtureCreateOutcome === "permission") {
          setError("Your workspace permission does not allow new projects. Nothing was created.");
          return;
        }
        if ((fixtureCreateOutcome === "error" || fixtureCreateOutcome === "unknown") && !fixtureFailedOnce) {
          setFixtureFailedOnce(true);
          setError(fixtureCreateOutcome === "unknown"
            ? "Otto could not confirm whether the project opened. Check before starting another — what you wrote is still here."
            : "The project could not be opened. What you wrote is still here, so sending it again is safe.");
          return;
        }
        writeNewFixtureProjectName(name);
        startCanvasFixtureConversation({
          projectId: NEW_PROJECT_FIXTURE_ID,
          messages: openingConversation(said, answer),
        });
        router.push(`/create/canvas?project=${NEW_PROJECT_FIXTURE_ID}&fixture=r22`);
      }, 360);
      return;
    }

    startTransition(async () => {
      const result = await createProject(name);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      // 真实那一支还没有会话存档可写,所以这句话跟着地址进画布的 composer —— 商家不用
      // 再打一遍,而屏幕上没有任何一处假装 Otto 已经答过话了。
      const query = new URLSearchParams({ project: result.id, prompt: answer ? `${said} — ${answer}` : said });
      router.push(`/create/canvas?${query.toString()}`);
    });
  }

  function send() {
    const said = sentence.trim();
    if (!said || busy || asked) return;
    const ask = projectStartQuestion(said);
    if (!ask) {
      create("");
      return;
    }
    setAsked(ask);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="r22-projects-start" data-r22-project-start>
        <DialogHeader>
          <DialogTitle>{PROJECT_START_GREETING}</DialogTitle>
          <DialogDescription>
            Say it in your own words. Nothing is made yet — this just opens a project to work in.
          </DialogDescription>
        </DialogHeader>

        {/* 问题卡换成全站共用的那一份(Founder 2026-08-26 裁决第 2/4 条):Create 弹窗、
            画布、Otto 线程三处的问答从此是同一个零件。上一版这里、画布、Library 快产车间
            各画了一遍选项列表 —— 三份键盘行为迟早分家,而分家只有用键盘的人碰得到。
            `aliases` 保留这一面自己那套 DOM 钩子,既有验收一条都不用改。 */}
        {asked ? (
          <AskOptionCard
            idPrefix={askId}
            kicker={asked.header}
            question={asked.question}
            help={asked.help}
            options={asked.options}
            value={picked}
            onValueChange={setPicked}
            onSkip={() => create("")}
            onSubmit={() => create(picked)}
            submitLabel={busy ? "Opening…" : "Open the project"}
            busy={busy}
            className="r22-projects-ask"
            aliases={{ card: "data-r22-project-ask", option: "data-r22-project-ask-option", skip: "data-r22-project-ask-skip", submit: "data-r22-project-ask-go" }}
          />
        ) : null}

        {/* 起手模板 —— 与画布空态、Library 快产车间是同一个组件、同一批句子。点一下只把
            句子填进下面那个输入框:发送仍然是商家自己按的那一下。 */}
        <CreationTemplateRow locked={locked} onPick={(template) => { setSentence(template.prompt); composerRef.current?.focus(); }} />

        <form
          className="r22-projects-start-form"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          <Textarea
            unstyled
            ref={composerRef}
            rows={2}
            value={sentence}
            disabled={locked}
            aria-label="Tell Otto what this project is"
            placeholder={PROJECT_START_PLACEHOLDER}
            onChange={(event) => setSentence(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
          />
          <Button
            unstyled
            type="submit"
            className="r22-projects-start-send"
            aria-label="Send"
            disabled={busy || locked || !sentence.trim()}
          >
            <ArrowUp aria-hidden="true" />
          </Button>
        </form>

        {busy && !asked ? <p className="r22-projects-start-busy" role="status">Opening your project…</p> : null}
        {error ? <p className="r22-projects-error" role="alert">{error}</p> : null}
      </DialogContent>
    </Dialog>
  );
}

export default ProjectStartDialog;
