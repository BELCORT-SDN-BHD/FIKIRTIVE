import { depthClientTwo } from "./depth-client-two";
import { depthNestedClientTwo } from "./depth-client-two";

export function depthClientOne(client: unknown) {
  return depthClientTwo(client);
}

export function depthNestedClientOne(carrier: unknown) {
  return depthNestedClientTwo(carrier);
}
