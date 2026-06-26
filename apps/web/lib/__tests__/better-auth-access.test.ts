import { describe, it, expect } from "vitest";
import { superAdminRole } from "@/lib/better-auth/access";

describe("super-admin access role", () => {
  it("authorizes impersonate + ban + session revoke", () => {
    expect(superAdminRole.authorize({ user: ["impersonate"] }).success).toBe(true);
    expect(superAdminRole.authorize({ user: ["ban"] }).success).toBe(true);
    expect(superAdminRole.authorize({ session: ["revoke"] }).success).toBe(true);
  });
  it("denies a resource it does not grant", () => {
    // a made-up resource is not in the statement space → not authorized
    expect(superAdminRole.authorize({ billing: ["charge"] } as never).success).toBe(false);
  });
});
