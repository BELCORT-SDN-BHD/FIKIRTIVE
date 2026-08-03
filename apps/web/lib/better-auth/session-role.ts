import "server-only";
import { prisma } from "@fikirtive/db";
import { isRole, primaryPlatformRole, type Role } from "@fikirtive/core";

/** Compatibility role for session/UI surfaces that still display one value. */
export async function roleForEmail(email: string | null | undefined): Promise<Role> {
  if (!email) return "viewer";
  try {
    const row = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { role: true, roles: { select: { role: true } } },
    });
    const assignments = row?.roles?.map((assignment) => assignment.role) ?? [];
    const roles = assignments.length > 0
      ? assignments
      : isRole(row?.role)
        ? [row.role]
        : [];
    return primaryPlatformRole(roles);
  } catch {
    return "viewer";
  }
}
