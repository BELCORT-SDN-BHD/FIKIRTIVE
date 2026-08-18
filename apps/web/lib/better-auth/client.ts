"use client";

import { createAuthClient } from "better-auth/react";
import { emailOTPClient } from "better-auth/client/plugins";

/** The client plugin adds exactly one call the login page uses: `authClient.signIn.emailOtp`,
 *  the second step of the sign-in-code flow. Asking for the code is a server action, not a client
 *  call — see app/login/actions.ts. */
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_BETTER_AUTH_URL,
  basePath: "/api/better-auth",
  plugins: [emailOTPClient()],
});
