// Bypass class: sensitive DB access is reached through a repository object.
import { repository } from "../support/repository-leak";

export function leak() {
  return repository.load();
}
