// Bypass class: sensitive DB access is reached through an imported helper.
import { importedHelper } from "../support/imported-helper-leak";

export function leak() {
  return importedHelper();
}
