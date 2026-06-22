import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { T } from "../theme";

/** Brand promise scene: the Fikirtive wordmark + tagline, calm confident reveal. */
export const Intro: React.FC<{ tagline?: string; sub?: string }> = ({
  tagline = "The entity layer for AI video.",
  sub = "Lock your characters, places and products once — reference them across every model.",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const mark = spring({ frame, fps, config: { damping: 200, mass: 0.7 } });
  const markY = interpolate(mark, [0, 1], [26, 0]);
  const tagIn = interpolate(frame, [16, 34], [0, 1], { extrapolateRight: "clamp" });
  const tagY = interpolate(frame, [16, 34], [16, 0], { extrapolateRight: "clamp" });
  const subIn = interpolate(frame, [30, 48], [0, 1], { extrapolateRight: "clamp" });
  const glow = interpolate(frame, [0, 30], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(1200px 700px at 50% 38%, #131821 0%, ${T.bg0} 62%)`,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ textAlign: "center", padding: 60 }}>
        <div
          style={{
            font: "600 92px/1 Inter, sans-serif",
            letterSpacing: T.trackingDisplay,
            color: T.fg1,
            opacity: mark,
            transform: `translateY(${markY}px)`,
            textShadow: `0 0 ${40 * glow}px rgba(246,247,249,${0.22 * glow})`,
          }}
        >
          Fikirtive
        </div>
        <div
          style={{
            marginTop: 26,
            font: "600 38px/1.2 Inter, sans-serif",
            letterSpacing: T.trackingTight,
            color: T.fg1,
            opacity: tagIn,
            transform: `translateY(${tagY}px)`,
          }}
        >
          {tagline}
        </div>
        <div
          style={{
            marginTop: 16,
            maxWidth: 760,
            marginLeft: "auto",
            marginRight: "auto",
            font: "400 21px/1.5 Inter, sans-serif",
            color: T.fg2,
            opacity: subIn,
          }}
        >
          {sub}
        </div>
      </div>
    </AbsoluteFill>
  );
};
