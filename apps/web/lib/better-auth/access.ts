import "server-only";
import { createAccessControl } from "better-auth/plugins/access";

/** Statement space = the admin plugin's default statements (1.6.20). Kept explicit so our
 *  super-admin role grants exactly what the plugin's endpoints check. */
const statements = {
  user: ["create", "list", "set-role", "ban", "impersonate", "impersonate-admins", "delete", "set-password", "set-email", "get", "update"],
  session: ["list", "revoke", "delete"],
} as const;

export const ac = createAccessControl(statements);

/** Our canonical top role. `adminRoles: ["super-admin"]` in server.ts points here; the founder's
 *  mirrored ba_user.role === "super-admin" then passes hasPermission for impersonate/ban/etc. */
export const superAdminRole = ac.newRole({
  user: ["create", "list", "set-role", "ban", "impersonate", "impersonate-admins", "delete", "set-password", "set-email", "get", "update"],
  session: ["list", "revoke", "delete"],
});
