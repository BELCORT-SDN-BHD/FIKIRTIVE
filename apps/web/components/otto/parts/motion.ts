import type React from "react";

/**
 * Entry animation applied to newly-arrived message rows.
 * The `otto-msg-enter` keyframe is defined ONCE in OttoChatStream's <style> block.
 * This style should only be applied when animateIn / isNewMessage is true so that
 * seeded history messages (present at mount) do not play the animation on load.
 */
export const MSG_ENTER_STYLE: React.CSSProperties = {
  animation: "otto-msg-enter var(--dur-base, 220ms) var(--ease-spring, cubic-bezier(0.34,1.56,0.64,1)) both",
};
