/**
 * OPT-6 P1b — surface User.role onto the session. With the DB session strategy the
 * `session` callback receives the fresh User row (AdapterUser); we copy role onto
 * session.user.role so requireRole + the admin UI can read it type-safely.
 */
import type { Role } from "@artlio/core";

declare module "next-auth" {
  // augment the base User — next-auth's AdapterUser extends this, so the DB-session
  // `session({ user })` callback param (an AdapterUser) gets `role` too.
  interface User {
    role?: Role;
  }
  interface Session {
    user: {
      role?: Role;
    } & import("next-auth").DefaultSession["user"];
  }
}

declare module "@auth/core/adapters" {
  interface AdapterUser {
    role?: Role;
  }
}
