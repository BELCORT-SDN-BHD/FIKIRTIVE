// Bypass class: sensitive DB access is reached through a service object.
import { customerService } from "../support/service-leak";

export function leak() {
  return customerService.list();
}
