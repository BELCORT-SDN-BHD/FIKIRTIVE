import { interpolate, useCurrentFrame } from "remotion";
import { T } from "../theme";

/** Lower-third caption — on-brand, fades in fast, holds, fades out near the end
 *  of its sequence. Place inside a <Sequence> so frame 0 is the caption's start. */
export const Caption: React.FC<{ text: string; durationInFrames: number; sub?: string }> = ({
  text,
  durationInFrames,
  sub,
}) => {
  const frame = useCurrentFrame();
  const appear = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" });
  const rise = interpolate(frame, [0, 14], [18, 0], { extrapolateRight: "clamp" });
  const out = interpolate(frame, [durationInFrames - 12, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
  });
  const opacity = Math.min(appear, out);
  return (
    <div
      style={{
        position: "absolute",
        left: 96,
        bottom: 88,
        opacity,
        transform: `translateY(${rise}px)`,
      }}
    >
      <div
        style={{
          display: "inline-block",
          padding: "16px 24px",
          borderRadius: T.radiusLg,
          background: "rgba(10,12,16,0.66)",
          border: `1px solid ${T.line2}`,
          boxShadow: T.shadowGlass,
          backdropFilter: "blur(18px)",
        }}
      >
        <div style={{ font: "600 30px/1.2 Inter, sans-serif", color: T.fg1, letterSpacing: T.trackingTight }}>
          {text}
        </div>
        {sub ? (
          <div style={{ marginTop: 6, font: "500 17px/1.4 Inter, sans-serif", color: T.fg2 }}>{sub}</div>
        ) : null}
      </div>
    </div>
  );
};
