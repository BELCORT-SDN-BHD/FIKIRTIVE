/** Camera-motion presets (video). value = the phrase appended to the prompt —
 *  the mechanism prompt-based video models (Kling) take camera direction. */
export const CAMERA_PRESETS: [string, string][] = [
  ["", "Camera: auto"],
  ["static locked-off camera", "Static"],
  ["slow dolly in", "Dolly in"],
  ["slow dolly out", "Dolly out"],
  ["smooth pan left", "Pan left"],
  ["smooth pan right", "Pan right"],
  ["tilt up", "Tilt up"],
  ["tilt down", "Tilt down"],
  ["slow zoom in", "Zoom in"],
  ["slow zoom out", "Zoom out"],
  ["crane up", "Crane up"],
  ["crane down", "Crane down"],
  ["handheld camera", "Handheld"],
  ["orbit around the subject", "Orbit"],
];
