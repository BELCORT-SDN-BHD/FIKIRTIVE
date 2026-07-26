// Bypass class: a second same-package import hop exceeds the documented depth limit.
import { depthOne } from "../support/depth-one";

export function leak() {
  return depthOne();
}
