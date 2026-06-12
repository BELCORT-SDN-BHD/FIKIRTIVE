import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { T } from "../theme";

/** A real app screenshot inside a clean dark browser chrome, with a slow Ken-Burns
 *  push so static captures feel alive. `src` is a staticFile() URL (a PNG capture).
 *  When `src` is undefined it renders a labelled placeholder (footage pending). */
export const BrowserFrame: React.FC<{
  src?: string;
  label?: string;
  zoom?: number; // total push over the sequence (default subtle)
}> = ({ src, label, zoom = 0.06 }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const scale = 1 + interpolate(frame, [0, durationInFrames], [0, zoom], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: 70 }}>
      <div
        style={{
          width: "100%",
          maxWidth: 1640,
          borderRadius: T.radiusXl,
          overflow: "hidden",
          border: `1px solid ${T.line1}`,
          boxShadow: T.shadowPop,
          background: T.bg1,
        }}
      >
        {/* chrome bar */}
        <div
          style={{
            height: 44,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "0 16px",
            background: T.bg2,
            borderBottom: `1px solid ${T.line2}`,
          }}
        >
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <span key={c} style={{ width: 12, height: 12, borderRadius: 999, background: c, opacity: 0.9 }} />
          ))}
          <span
            style={{
              marginLeft: 14,
              padding: "5px 14px",
              borderRadius: 999,
              background: "rgba(255,255,255,0.05)",
              border: `1px solid ${T.line2}`,
              font: "400 13px/1 ui-monospace, monospace",
              color: T.fg3,
            }}
          >
            artl.io / studio
          </span>
        </div>
        {/* viewport */}
        <div style={{ position: "relative", aspectRatio: "16 / 9", background: T.bg0, overflow: "hidden" }}>
          {src ? (
            <Img
              src={src}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                transform: `scale(${scale})`,
                transformOrigin: "center",
              }}
            />
          ) : (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "grid",
                placeItems: "center",
                color: T.fg4,
                font: "500 16px/1.4 ui-monospace, monospace",
                letterSpacing: T.trackingMonoLabel,
              }}
            >
              {label ?? "FOOTAGE PENDING"}
            </div>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};
