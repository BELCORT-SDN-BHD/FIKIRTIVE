import { Composition, Sequence, AbsoluteFill } from "remotion";
import { loadFont } from "@remotion/google-fonts/Inter";
import { VIDEO } from "./theme";
import { Intro } from "./scenes/Intro";
import { BrowserFrame } from "./components/BrowserFrame";
import { Caption } from "./components/Caption";

loadFont(); // registers "Inter" for every scene

const F = VIDEO.fps;
const s = (sec: number) => Math.round(sec * F);

// scene plan (seconds) — mirrors SCRIPT.md; footage scenes hold a placeholder
// until the real captures land in public/ and get wired in.
const SCENES = {
  hook: { from: 0, dur: 11 },
  promise: { from: 11, dur: 10 },
  elements: { from: 21, dur: 23 },
  storyboard: { from: 44, dur: 30 },
  neutral: { from: 74, dur: 16 },
  editor: { from: 90, dur: 24 },
  close: { from: 114, dur: 11 },
};
const TOTAL = s(SCENES.close.from + SCENES.close.dur);

const Walkthrough: React.FC = () => (
  <AbsoluteFill style={{ background: "#0a0c10" }}>
    <Sequence from={s(SCENES.hook.from)} durationInFrames={s(SCENES.hook.dur)}>
      <Intro tagline="A better model ships every few weeks." sub="And every switch costs you your characters, your locations, your look." />
    </Sequence>

    <Sequence from={s(SCENES.promise.from)} durationInFrames={s(SCENES.promise.dur)}>
      <Intro />
    </Sequence>

    <Sequence from={s(SCENES.elements.from)} durationInFrames={s(SCENES.elements.dur)}>
      <BrowserFrame label="ELEMENTS · @MENTION" />
      <Caption text="Lock an element once" sub="Reference it in any prompt with @ — by name, on-model." durationInFrames={s(SCENES.elements.dur)} />
    </Sequence>

    <Sequence from={s(SCENES.storyboard.from)} durationInFrames={s(SCENES.storyboard.dur)}>
      <BrowserFrame label="STORYBOARD · DUAL-FRAME SEGMENT" />
      <Caption text="Plan as segments" sub="Start frame → end frame → Animate. Your model, your duration." durationInFrames={s(SCENES.storyboard.dur)} />
    </Sequence>

    <Sequence from={s(SCENES.neutral.from)} durationInFrames={s(SCENES.neutral.dur)}>
      <Intro tagline="Model-neutral by design." sub="Same entities, same storyboard — Kling, Veo, Seedance, LTX. Switch freely." />
    </Sequence>

    <Sequence from={s(SCENES.editor.from)} durationInFrames={s(SCENES.editor.dur)}>
      <BrowserFrame label="EDITOR · TRANSITIONS · EXPORT" />
      <Caption text="Assemble & export" sub="Trim, transition, balance audio — then render a finished film." durationInFrames={s(SCENES.editor.dur)} />
    </Sequence>

    <Sequence from={s(SCENES.close.from)} durationInFrames={s(SCENES.close.dur)}>
      <Intro tagline="Your entities. Every model. One film." sub="Artlio" />
    </Sequence>
  </AbsoluteFill>
);

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Walkthrough"
    component={Walkthrough}
    durationInFrames={TOTAL}
    fps={VIDEO.fps}
    width={VIDEO.width}
    height={VIDEO.height}
  />
);
