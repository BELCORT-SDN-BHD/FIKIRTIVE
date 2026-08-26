"use client";

/**
 * LibraryQuickCreate.tsx —— 仓库里的快产车间。
 *
 * 商家站在自己已有的东西中间,最常想的下一件事是「再要一张这样的」。那条路今天要走
 * 「回首页 → 进画布 → 选项目 → 说话」四步,而他要的东西就在眼前。所以这条生成条从
 * Library 页内浮出来:同一句话,同一套参数,同一个价钱。
 *
 * 三条不是这一面自己发明的规矩:
 *   ① **语汇照画布 composer** —— prompt 输入 + Image|Video + 比例/张数弹层 + cr 报价。
 *      两面长得不一样,商家就得学两遍;所以连价目都是从画布那份常量里读的
 *      (`r22-canvas-fixture.ts`),这里一个价格字面量都没有。
 *   ② **含糊就先问一句** —— 判词在 `quickCreateQuestion()`。问的时候一分钱不动,而且
 *      **所见即所付**:问题卡在的那段时间,类型/张数/比例三个控件一起锁住,报价因此不动。
 *      上一版只把**显示**的数字冻住、控件照样能拨,于是卡上写着 3 cr、实际按拨到的 4 张
 *      收 12 cr —— 冻显示不冻请求,是这一面能犯的最贵的一种谎。
 *      (顺带:跳动的价钱也等于在说「你多想了一会儿就变贵了」,所以锁,不是让它跳。)
 *   ③ **Esc 不越层** —— 进来先看 `defaultPrevented`,自己吃掉了就喊一声。这条链
 *      壳层与画布都守着,少一头一记 Esc 就撕两层。
 */

import { ArrowUp, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CANVAS_IMAGE_MAX_VARIANT_COUNT } from "@/lib/canvas-gen-costs";
import {
  FIXTURE_RATIO_OPTIONS,
  fixtureQuoteCredits,
  type CanvasMakeKind,
} from "@/components/canvas/r22-canvas-fixture";

import { quickCreateQuestion, type QuickCreateQuestion } from "./library-fixture";

export type QuickCreateRequest = { prompt: string; kind: CanvasMakeKind; count: number; ratio: string };

export function LibraryQuickCreate({
  open,
  busy,
  onClose,
  onRun,
}: {
  open: boolean;
  /** 上一次还在跑的时候,发送键关着 —— 一句话不该同时排两次。 */
  busy: boolean;
  onClose: () => void;
  onRun: (request: QuickCreateRequest) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<CanvasMakeKind>("image");
  const [count, setCount] = useState(1);
  const [ratio, setRatio] = useState(FIXTURE_RATIO_OPTIONS[0]!);
  const [paramsOpen, setParamsOpen] = useState(false);
  const [question, setQuestion] = useState<QuickCreateQuestion | null>(null);
  const [picked, setPicked] = useState("");
  const promptRef = useRef<HTMLTextAreaElement>(null);
  /** 问题卡上那三个选项各自的按钮 —— 方向键要把焦点搬过去,得先拿得到它们。 */
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  /**
   * 问题卡在的时候参数锁住。锁的是**请求**,不是显示:报价是从同一组参数算出来的,参数
   * 动不了,卡上承诺的那个数就是最后真的扣的那个数。
   */
  const locked = question !== null;
  const quote = fixtureQuoteCredits(kind, count);

  useEffect(() => {
    if (open) promptRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- close 是本组件内的一个稳定收尾动作,进依赖只会每次重挂监听。
  }, [open]);

  function close() {
    setParamsOpen(false);
    setQuestion(null);
    setPicked("");
    onClose();
  }

  function run(text: string) {
    setQuestion(null);
    setPicked("");
    setParamsOpen(false);
    setPrompt("");
    onRun({ prompt: text, kind, count, ratio });
  }

  function send() {
    const next = prompt.trim();
    if (!next || busy) return;
    const ask = quickCreateQuestion(next);
    if (!ask) return run(next);
    // 等着回答的这段时间里,参数一起锁住 —— 报价不动,而且动不了的是请求本身。
    setParamsOpen(false);
    setQuestion(ask);
  }

  /**
   * 单选组的键盘行为。`role="radiogroup"` 配一排普通按钮时,方向键什么都不做、Tab 会
   * 一个一个穿过去 —— 屏幕上是一组单选,用起来不是。这里补齐标准那一套:方向键在组内
   * 循环移动并选中(焦点跟着选中走),空格选中此刻这一个,Tab 只进出组一次。
   */
  function onOptionKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    if (!question) return;
    const last = question.options.length - 1;
    if (event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      setPicked(question.options[index]!.label);
      return;
    }
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const backward = event.key === "ArrowLeft" || event.key === "ArrowUp";
    if (!forward && !backward) return;
    event.preventDefault();
    const next = forward ? (index === last ? 0 : index + 1) : (index === 0 ? last : index - 1);
    setPicked(question.options[next]!.label);
    optionRefs.current[next]?.focus();
  }

  if (!open) return null;

  return (
    <div className="r22-lib-make" data-r22-lib-make role="region" aria-label="Make something new">
      {question ? (
        <div className="r22-lib-ask" data-r22-lib-ask>
          <p className="r22-lib-ask-kicker">{question.header}</p>
          <h3>{question.question}</h3>
          <p className="r22-lib-ask-help">{question.help}</p>
          <div className="r22-lib-ask-options" role="radiogroup" aria-label={question.question}>
            {question.options.map((option, index) => (
              <Button
                unstyled
                type="button"
                key={option.label}
                ref={(node: HTMLButtonElement | null) => { optionRefs.current[index] = node; }}
                role="radio"
                aria-checked={picked === option.label}
                // 一组单选在 Tab 序里只占一站:选中的那一个可聚焦,没选中的靠方向键到达。
                tabIndex={picked ? (picked === option.label ? 0 : -1) : index === 0 ? 0 : -1}
                data-r22-lib-ask-option={option.label}
                className={picked === option.label ? "is-selected" : ""}
                onKeyDown={(event) => onOptionKeyDown(event, index)}
                onClick={() => setPicked(option.label)}
              >
                <b>{option.label}</b>
                <small>{option.description}</small>
              </Button>
            ))}
          </div>
          <div className="r22-lib-ask-acts">
            <span>Waiting costs 0 cr.</span>
            <Button unstyled type="button" data-r22-lib-ask-skip onClick={() => run(prompt.trim())}>Skip and make it anyway</Button>
            <Button unstyled type="button" className="is-primary" disabled={!picked} data-r22-lib-ask-go onClick={() => run(`${prompt.trim()} — ${picked}`)}>Make it</Button>
          </div>
        </div>
      ) : null}

      <form
        className="r22-lib-make-form"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <Textarea
          unstyled
          ref={promptRef}
          rows={1}
          value={prompt}
          aria-label="Describe what to make"
          placeholder="Describe what to make…"
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
        />
        {/* `locked` 那几处 disabled 就是「所见即所付」本身:问题卡上写着多少 cr,答完
            之后跑的就是同一组参数。控件不锁住,冻住的那个数字只是屏幕上的一句好话。 */}
        <div className="r22-lib-make-row">
          <div className="r22-lib-make-kind" role="group" aria-label="What to make">
            <Button unstyled type="button" disabled={locked} aria-pressed={kind === "image"} data-r22-lib-kind="image" onClick={() => setKind("image")}>Image</Button>
            <Button unstyled type="button" disabled={locked} aria-pressed={kind === "video"} data-r22-lib-kind="video" onClick={() => setKind("video")}>Video</Button>
          </div>
          <span className="r22-lib-make-gap" />
          <div className="r22-lib-make-params">
            <Button unstyled type="button" className="r22-lib-make-shape" disabled={locked} aria-expanded={paramsOpen} onClick={() => setParamsOpen((value) => !value)}>
              {count > 1 ? `${ratio} · ${count}` : ratio}
            </Button>
            {paramsOpen && !locked ? (
              <div className="r22-lib-make-menu" data-r22-lib-params>
                <div className="r22-lib-make-shapes" role="group" aria-label="Shape">
                  {FIXTURE_RATIO_OPTIONS.map((value) => (
                    <Button unstyled type="button" key={value} aria-pressed={ratio === value} data-r22-lib-ratio={value} onClick={() => setRatio(value)}>
                      <i style={{ aspectRatio: value.replace(":", " / ") }} aria-hidden="true" />
                      <span>{value}</span>
                    </Button>
                  ))}
                </div>
                <div className="r22-lib-make-counts" role="group" aria-label="How many">
                  {Array.from({ length: CANVAS_IMAGE_MAX_VARIANT_COUNT }, (_, index) => index + 1).map((value) => (
                    <Button unstyled type="button" key={value} aria-pressed={count === value} data-r22-lib-count={value} onClick={() => setCount(value)}>{value}</Button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          <span className="r22-lib-make-price" data-r22-lib-price>{quote} cr</span>
          <Button unstyled type="submit" className="r22-lib-make-send" aria-label="Send" disabled={busy || !prompt.trim() || question !== null}>
            <ArrowUp aria-hidden="true" />
          </Button>
          <Button unstyled type="button" className="r22-lib-make-x" aria-label="Close" onClick={close}><X aria-hidden="true" /></Button>
        </div>
      </form>
    </div>
  );
}

export default LibraryQuickCreate;
